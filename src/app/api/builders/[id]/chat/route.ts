// One chat turn against one Builder profile, streamed as NDJSON.
//
// Every builder-backed agent instance posts here. The instance id is optional:
// with one, the turn is read from and appended to that agent's transcript; the
// route can also be used bare against a profile, which is what the QA fixture
// does without touching anyone's history.

import { checkLocalRequest } from "@/lib/localOnly";
import { NextResponse } from "next/server";
import { getBuilder } from "@/lib/builders/registry";
import { runBuilderChat, agentWorkDir, type ChatEvent } from "@/lib/builders/chat";
import { readHistory, appendTurn, packPrompt } from "@/lib/builders/history";
import { getAgent } from "@/lib/agents-registry";
import { executeGovernedBuilder } from "@/lib/agentRuntime/builder-execution";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PROMPT = 16_000;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const { id } = await ctx.params;

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Body must be JSON." }, { status: 400 }); }

  const prompt = String(body.prompt ?? "").trim();
  if (!prompt) return NextResponse.json({ error: "Type something to send." }, { status: 400 });
  if (prompt.length > MAX_PROMPT) {
    return NextResponse.json(
      { error: `That prompt is ${prompt.length} characters; the limit is ${MAX_PROMPT}.` },
      { status: 413 },
    );
  }

  const builder = await getBuilder(id);
  if (!builder) return NextResponse.json({ error: `No Builder profile "${id}".` }, { status: 404 });

  const agentId = body.agentId ? String(body.agentId) : null;
  if (agentId) {
    const agent = await getAgent(agentId);
    if (!agent) return NextResponse.json({ error: `No agent "${agentId}".` }, { status: 404 });
    // The agent must actually be bound to this profile. Without the check, a
    // request could append one profile's answer to another agent's transcript.
    // The kind is half of that: Router ids and Builder ids are both slugs of a
    // name, from different files, so "glm" can name one of each.
    if (agent.backend.kind !== "builder" || agent.backend.refId !== id) {
      return NextResponse.json(
        { error: `"${agent.name}" is not bound to this profile.` },
        { status: 409 },
      );
    }
  }

  const history = agentId ? await readHistory(agentId) : [];
  const packed = packPrompt(history, prompt);

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (o: unknown) => {
        if (!open) return;
        try { controller.enqueue(enc.encode(JSON.stringify(o) + "\n")); }
        catch { open = false; }
      };

      if (packed.dropped) {
        send({ t: "note", c: `Carrying the last ${history.length - packed.dropped} turns; ${packed.dropped} older ones did not fit.` });
      }

      // Delegation to Go authority when SEN_GO_BUILDER_EXEC_AUTHORITY=1
      const useGoAuthority = process.env.SEN_GO_BUILDER_EXEC_AUTHORITY === "1";
      const cwd = agentId ? agentWorkDir(agentId) : process.cwd();
      const taskId = (body.taskId as string) || agentId || `builder-turn-${id}-${Date.now()}`;
      const attemptId = (body.attemptId as string) || `attempt-${Date.now()}`;
      const traceId = (body.traceId as string) || `trace-${Date.now()}`;
      const runId = (body.runId as string) || `run-${Date.now()}`;

      let result;
      if (useGoAuthority) {
        const govResult = await executeGovernedBuilder({
          builderId: id,
          prompt: packed.text,
          cwd,
          taskId,
          attemptId,
          traceId,
          runId,
          signal: req.signal,
        });
        result = {
          text: govResult.text,
          exitCode: govResult.ok ? 0 : 1,
          durationMs: govResult.durationMs,
          timedOut: false,
          error: govResult.error ?? null,
          sessionId: govResult.sessionId ?? null,
          actualModel: govResult.actualModel ?? null,
          ttfbMs: null,
          usage: govResult.usage ?? null,
          protocolError: null,
          aborted: req.signal.aborted,
        };
      } else {
        result = await runBuilderChat({
          builder,
          prompt: packed.text,
          cwd: agentId ? agentWorkDir(agentId) : undefined,
          signal: req.signal,
          emit: (e: ChatEvent) => send(e),
        });
      }

      // The transcript records the user's own words, not the packed prompt —
      // saving the packed text would re-inline the whole history next turn.
      if (agentId) {
        const ts = new Date().toISOString();
        try {
          await appendTurn(agentId, { role: "user", text: prompt, ts });
          if (result.text.trim()) {
            await appendTurn(agentId, { role: "assistant", text: result.text, ts: new Date().toISOString() });
          }
        } catch (e) {
          send({ t: "note", c: `The answer arrived but could not be saved: ${String((e as Error)?.message ?? e)}` });
        }
      }

      send({ t: "final", ok: !result.error, error: result.error, ms: result.durationMs });
      if (open) controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
    },
  });
}
