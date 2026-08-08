// Chat with the Sen runtime agent, streamed as NDJSON — the agent half of
// the Sen surface. This implementation stays under /api/firstmate for legacy
// compatibility; /api/sen/agent re-exports it.
//
// Same house streaming style as /api/routers/[id]/chat: one JSON object per
// line, a final marker, no SSE framing.
//
//   POST {prompt, threadId?, routerId?, builderId?, model?, effort?} → run Sen, events:
//     {t:"run", id, threadId}            the run's ids, first
//     {t:"note", c}                      an MCP connector that would not connect
//     {t:"text", c}                      what the brain said this turn
//     {t:"tool", name, args, preview, error?, decision}
//     {t:"approval-parked", approvalId, tool, summary}   the run blocked; the ask is in the Inbox
//     {t:"artifacts", items:[{path, kind}]}
//     {t:"finish", status, text, runId, threadId}

import { checkLocalRequest } from "@/lib/localOnly";
import { NextResponse } from "next/server";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath } from "node:fs/promises";
import { existsSync } from "node:fs";
import { AGENTIC_HOME } from "@/lib/builders/registry";
import { getRouter, routerKind } from "@/lib/routers/registry";
import { run, resume } from "@/lib/agentRuntime/runner";
import { FileStateStore, type RunState, type RunStep } from "@/lib/agentRuntime/state";
import type { ChatMessage } from "@/lib/routers/adapters/base";
import { buildAukerAgent } from "@/lib/agentRuntime/presets/sen";
import { enabledMcpConfigs } from "@/lib/mcpServers";
import { listApprovals, redactedApprovalSummary } from "@/lib/approvals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PROMPT = 16_000;

// The efforts the picker offers.
const EFFORTS = new Set(["low", "medium", "high", "xhigh"]);

function home(): string { return process.env.AGENTIC_OS_HOME ?? AGENTIC_HOME; }
function runsDir(): string { return path.join(home(), "runtime", "runs"); }

const ARTIFACT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

export async function GET(req: Request) {
  const guard = checkLocalRequest(req, { requireJson: false, allowQueryToken: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const url = new URL(req.url);
  const runId = url.searchParams.get("run") ?? "";
  const rel = url.searchParams.get("path") ?? "";
  if (!runId || !rel) {
    return NextResponse.json({ error: "Which artifact? (?run=<runId>&path=<artifact path>)" }, { status: 400 });
  }
  try {
    const store = new FileStateStore(runsDir());
    const state = await store.load(runId);
    if (!state) return NextResponse.json({ error: `No run "${runId}".` }, { status: 404 });
    if (!state.artifacts.some((a) => a.path === rel)) {
      return NextResponse.json({ error: `"${rel}" is not an artifact of run "${runId}".` }, { status: 404 });
    }
    const runDir = store.runDir(runId);
    const abs = path.resolve(runDir, rel);
    const relToRun = path.relative(await realpath(runDir), existsSync(abs) ? await realpath(abs) : abs);
    if (relToRun.startsWith("..") || path.isAbsolute(relToRun)) {
      return NextResponse.json({ error: "That path leaves the run directory." }, { status: 400 });
    }
    const buf = await readFile(abs);
    if (buf.length > 2 * 1024 * 1024) {
      return NextResponse.json({ error: "That artifact is over 2 MB — open it from the run folder on disk." }, { status: 413 });
    }
    return new Response(new Uint8Array(buf), {
      headers: { "content-type": ARTIFACT_TYPES[path.extname(rel).toLowerCase()] ?? "application/octet-stream" },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Body must be JSON." }, { status: 400 }); }

  const resumeRunId = body.resume ? String(body.resume) : null;
  const prompt = String(body.prompt ?? "").trim();
  if (!resumeRunId) {
    if (!prompt) return NextResponse.json({ error: "Type something to send." }, { status: 400 });
    if (prompt.length > MAX_PROMPT) {
      return NextResponse.json(
        { error: `That prompt is ${prompt.length} characters; the limit is ${MAX_PROMPT}.` },
        { status: 413 },
      );
    }
  }

  let storedBrain: RunState["brain"];
  let pendingApproval: RunState["pendingApproval"];
  if (resumeRunId) {
    let existing: RunState | null;
    try { existing = await new FileStateStore(runsDir()).load(resumeRunId); }
    catch (e) { return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 }); }
    if (!existing) {
      return NextResponse.json({ error: `No run "${resumeRunId}" in this store.` }, { status: 404 });
    }
    storedBrain = existing.brain;
    pendingApproval = existing.pendingApproval;
  }

  // Modern runs own their persisted brain identity. Request-side identity picks
  // are only a compatibility escape hatch for legacy states without `brain`.
  const builderId = storedBrain
    ? storedBrain.builderId
    : body.builderId ? String(body.builderId) : undefined;
  const askedRouterId = storedBrain
    ? storedBrain.routerId
    : body.routerId ? String(body.routerId) : undefined;
  const router = !builderId && askedRouterId ? await getRouter(askedRouterId) : null;
  if (!builderId && !router) {
    return NextResponse.json(
      { error: askedRouterId
        ? `No Router "${askedRouterId}".`
        : "Choose a verified Builder for Sen, or explicitly select a Router integration." },
      { status: askedRouterId ? 404 : 400 },
    );
  }

  let approval: "approve" | "deny" | undefined;
  if (resumeRunId) {
    const asks = await listApprovals();
    const matches = pendingApproval
      ? asks.filter((a) =>
          a.runId === resumeRunId
          && a.toolCallId === pendingApproval.toolCallId
          && a.tool === pendingApproval.tool
          && JSON.stringify(a.args) === JSON.stringify(pendingApproval.args))
      : [];
    const matching = matches.length === 1 ? matches[0] : undefined;
    if (!matching || (matching.status !== "approved" && matching.status !== "rejected")) {
      return NextResponse.json(
        { error: matches.length > 1
          ? `Multiple asks match the pending tool call for run "${resumeRunId}"; refusing an ambiguous resume.`
          : matching?.status === "pending"
            ? "That run's ask is still waiting in the Inbox — answer it there first."
            : `No decided ask matches the pending tool call for run "${resumeRunId}".` },
        { status: 409 },
      );
    }
    approval = matching.status === "approved" ? "approve" : "deny";
  }

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (o: unknown) => {
        if (!open) return;
        try { controller.enqueue(enc.encode(JSON.stringify(o) + "\n")); }
        catch { open = false; }
      };

      const stateStore = new FileStateStore(runsDir());
      const freshRunId = resumeRunId ? null : randomUUID();
      const ws = resumeRunId ? stateStore.runDir(resumeRunId) : stateStore.runDir(freshRunId!);
      await mkdir(ws, { recursive: true });

      let parked: { approvalId: string; tool: string; summary: string } | null = null;
      const model = storedBrain
        ? storedBrain.model
        : body.model ? String(body.model) : undefined;
      const effort = storedBrain
        ? storedBrain.effort
        : body.effort && EFFORTS.has(String(body.effort)) ? String(body.effort) : undefined;
      const fm = await buildAukerAgent({
        routerId: router?.id,
        builderId: builderId ?? undefined,
        builderSessionId: storedBrain?.builderSessionId,
        runId: resumeRunId ?? freshRunId ?? undefined,
        model,
        effort,
        workspace: ws,
        mcpServers: await enabledMcpConfigs().catch(() => []),
        approvalSource: "firstmate",
        // Never stream the stored raw-argument summary; use the redacted,
        // hash-bound one (Phase 20 approval-read redaction).
        onParked: (item) => { parked = { approvalId: item.id, tool: item.tool, summary: redactedApprovalSummary(item) }; },
      });

      {
        if (builderId) {
          send({ t: "note", c: `Brain: Builder (${builderId}) · model ${model ?? "(default)"}` });
        } else if (router) {
          const useModel = model ?? router.defaultModel;
          const adapter = routerKind(router.kind)?.adapter ?? "openai-compatible";
          const effortNote = !effort ? ""
            : adapter === "openai-compatible"
              ? ` · effort ${effort} (sent as reasoning_effort — the endpoint may ignore it)`
              : ` · effort ${effort} requested, but the ${adapter} adapter has no wire name for it — endpoint default`;
          send({ t: "note", c: `Brain: ${router.name} · model ${useModel ?? "(router default — the endpoint picks)"}${effortNote}` });
        }
      }
      for (const e of fm.mcpErrors) {
        send({ t: "note", c: `MCP server "${e.name}" would not connect (${e.error}) — its tools are skipped this run.` });
      }

      const onStep = (step: RunStep, state: RunState) => {
        if (step.kind === "brain" && step.text) send({ t: "text", c: step.text });
        if (step.kind === "tool") {
          let preview = "";
          try { preview = JSON.stringify(step.result ?? null); } catch { preview = ""; }
          if (preview.length > 300) preview = `${preview.slice(0, 297)}…`;
          send({ t: "tool", name: step.name, args: step.args, preview, error: step.error, decision: step.decision });
        }
        if (step.kind === "finish" && state.artifacts.length) {
          send({ t: "artifacts", items: state.artifacts.map((a) => ({ path: a.path, kind: a.kind })) });
        }
      };

      let seedMessages: ChatMessage[] | undefined;
      if (!resumeRunId && body.threadId) {
        const prev = await stateStore.latestInThread(String(body.threadId)).catch(() => null);
        if (prev) {
          const seed = prev.messages.filter((m) => m.role !== "system");
          while (seed.length) {
            const last = seed[seed.length - 1];
            if (last.role === "assistant" && last.toolCalls?.length) seed.pop();
            else break;
          }
          if (seed.length) seedMessages = seed;
        }
      }

      try {
        const result = resumeRunId
          ? await resume(fm.agent, resumeRunId, {
              stateStore, policies: fm.policies, approval, onStep, signal: req.signal,
            })
          : await run(fm.agent, prompt, {
              stateStore, policies: fm.policies, onStep, signal: req.signal,
              threadId: body.threadId ? String(body.threadId) : undefined,
              runId: freshRunId ?? undefined,
              seedMessages,
            });
        if (result.status === "blocked" && parked) {
          const p = parked as { approvalId: string; tool: string; summary: string };
          send({ t: "approval-parked", approvalId: p.approvalId, tool: p.tool, summary: p.summary });
        }
        send({ t: "finish", status: result.status, text: result.finalText, runId: result.runId, threadId: result.state.threadId });
      } catch (e) {
        send({ t: "finish", status: "failed", text: String((e as Error)?.message ?? e) });
      } finally {
        await fm.close();
        if (open) controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
    },
  });
}
