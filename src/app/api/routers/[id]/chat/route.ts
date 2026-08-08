// One chat turn against one Router profile, streamed as NDJSON.
//
// The sibling of /api/builders/[id]/chat, and deliberately the same shape: same
// guard, same prompt ceiling, same agent-binding check, same event stream. A
// router-backed agent and a builder-backed one differ in what answers, not in
// how the page talks to it.

import { checkLocalRequest } from "@/lib/localOnly";
import { NextResponse } from "next/server";
import { getRouter } from "@/lib/routers/registry";
import { runRouterChat, type RouterChatEvent } from "@/lib/routers/chat";
import { readHistory, appendTurn } from "@/lib/builders/history";
import { getAgent } from "@/lib/agents-registry";

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

  const router = await getRouter(id);
  if (!router) return NextResponse.json({ error: `No Router "${id}".` }, { status: 404 });

  const agentId = body.agentId ? String(body.agentId) : null;
  let model = body.model ? String(body.model) : null;
  if (agentId) {
    const agent = await getAgent(agentId);
    if (!agent) return NextResponse.json({ error: `No agent "${agentId}".` }, { status: 404 });
    // The agent must actually be bound to this Router. Without the check, a
    // request could bill one endpoint and file the answer under another agent.
    // The kind is half of that: Router ids and Builder ids are both slugs of a
    // name, from different files, so "glm" can name one of each.
    if (agent.backend.kind !== "router" || agent.backend.refId !== id) {
      return NextResponse.json({ error: `"${agent.name}" is not bound to this Router.` }, { status: 409 });
    }
    model = model ?? agent.model;
  }

  const history = agentId ? await readHistory(agentId) : [];

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (o: unknown) => {
        if (!open) return;
        try { controller.enqueue(enc.encode(JSON.stringify(o) + "\n")); }
        catch { open = false; }
      };

      const result = await runRouterChat({
        router,
        prompt,
        history,
        model,
        signal: req.signal,
        emit: (e: RouterChatEvent) => send(e),
      });

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
