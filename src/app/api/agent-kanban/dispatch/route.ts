import { checkLocalRequest } from "@/lib/localOnly";
import { getApiToken } from "@/lib/apiToken";
import { NextResponse } from "next/server";
import { getBuilder } from "@/lib/builders/registry";
import { createSession } from "@/lib/sen-sessions";
import {
  bindAttemptSession,
  createAttempt,
  getCard,
  KanbanStoreError,
  setRuntime,
  transitionCard,
  updateAttempt,
} from "@/lib/agent-kanban/store";
import { commandFileForAttempt, ensureKanbanCommandMonitor, notifyKanbanActivityChanged } from "@/lib/agent-kanban/command-reader";
import { goApiAvailable, goApiFetch } from "@/lib/goApiProxy";
import type { GoBoardSnapshot, GoKanbanCard } from "@/lib/agent-kanban/go-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const activeDispatches = new Map<string, AbortController>();

type CanonicalDispatch =
  | { kind: "committed"; attemptId: string }
  | { kind: "error"; response: NextResponse };

// Canonical dispatch forwarding (phase 10 step 5): when the card is a
// canonical task, the state mutation (todo→doing + attempt creation + fence)
// commits through the Go control plane in one transaction. The streaming
// orchestration below stays legacy for now; legacy kanban-store writes are
// skipped for canonical cards (their authority is the canonical projection).
async function resolveCanonicalCard(cardId: string): Promise<{ card: GoKanbanCard | null; unreachable: boolean }> {
  if (!(await goApiAvailable())) return { card: null, unreachable: false };
  const board = await goApiFetch("/v1/kanban/board");
  if (!board.ok || !board.body || typeof board.body !== "object") {
    // Configured but unreachable: a dispatch is a write — fail closed instead
    // of silently mutating the legacy store for a possibly-canonical card.
    return { card: null, unreachable: true };
  }
  const card = ((board.body as GoBoardSnapshot).Cards ?? []).find((entry) => entry.TaskID === cardId);
  return { card: card ?? null, unreachable: false };
}

async function commitCanonicalDispatch(
  card: { TaskID: string; WorkflowStage: string; Version: number },
  builderId: string,
): Promise<CanonicalDispatch> {
  const cardId = card.TaskID;
  // A backlog card accepts the dispatch pre-step first (todo), matching the
  // legacy route's transition sequence.
  if (card.WorkflowStage === "backlog") {
    const accept = await goApiFetch(`/v1/kanban/tasks/${encodeURIComponent(cardId)}/transition`, {
      method: "POST",
      body: {
        commandId: `dispatch-accept-${cardId}-${crypto.randomUUID()}`,
        to: "todo",
        expectedVersion: card.Version,
        actor: "firstmate",
        note: "Accepted for dispatch.",
      },
    });
    if (accept.unreachable) {
      return { kind: "error", response: NextResponse.json({ error: "canonical accept may have been applied upstream; retry the dispatch" }, { status: 503 }) };
    }
    if (!accept.ok) {
      const code = accept.status === 409 ? 409 : accept.status === 404 ? 404 : accept.status >= 500 ? 502 : 400;
      const message = (accept.body as { message?: string } | null)?.message ?? "canonical accept failed";
      return { kind: "error", response: NextResponse.json({ error: message }, { status: code }) };
    }
    card.Version = ((accept.body as { version?: number })?.version ?? card.Version + 1);
  }

  const commandId = `dispatch-${cardId}-${crypto.randomUUID()}`;
  const result = await goApiFetch(`/v1/kanban/tasks/${encodeURIComponent(cardId)}/dispatch`, {
    method: "POST",
    body: { commandId, builderId, expectedVersion: card.Version, actor: "firstmate" },
  });
  // Never fall through to the legacy store once the write may have committed.
  if (result.unreachable) {
    return { kind: "error", response: NextResponse.json({ error: "canonical dispatch may have been applied upstream; retry the dispatch" }, { status: 503 }) };
  }
  if (!result.ok) {
    const code = result.status === 409 ? 409 : result.status === 404 ? 404 : result.status >= 500 ? 502 : 400;
    const message = (result.body as { message?: string } | null)?.message ?? "canonical dispatch failed";
    return { kind: "error", response: NextResponse.json({ error: message }, { status: code }) };
  }
  const outcome = result.body as { attemptId?: string };
  if (!outcome.attemptId) {
    return { kind: "error", response: NextResponse.json({ error: "canonical dispatch returned no attempt id" }, { status: 502 }) };
  }
  return { kind: "committed", attemptId: outcome.attemptId };
}

export async function POST(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });
  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Body must be JSON." }, { status: 400 }); }

  const cardId = typeof body.cardId === "string" ? body.cardId : "";
  const mode = body.mode === "pane" ? "pane" : "lane";
  if (mode === "pane") {
    return NextResponse.json({
      error: "Pane mode is waiting for Windows compatibility; use lane mode.",
      code: "pane-windows-compat",
    }, { status: 409 });
  }

  // Canonical-first: when the card is a canonical task, the state mutation
  // commits through the Go control plane; legacy cards stay on the legacy
  // store. The streaming orchestration below is shared by both paths.
  const requestedBuilder = typeof body.builderId === "string" && body.builderId ? body.builderId : "";
  const canonicalLookup = await resolveCanonicalCard(cardId);
  if (canonicalLookup.unreachable) {
    return NextResponse.json({ error: "canonical control plane is unreachable; refusing to dispatch through the legacy store" }, { status: 503 });
  }
  const canonCard = canonicalLookup.card;
  const legacyCard = canonCard ? null : await getCard(cardId);
  if (!canonCard && !legacyCard) {
    return NextResponse.json({ error: `No Kanban card "${cardId}".` }, { status: 404 });
  }
  const builderId = requestedBuilder
    || canonCard?.BuilderID
    || legacyCard?.attempts.at(-1)?.builderId
    || "";
  if (!builderId) return NextResponse.json({ error: "Choose a verified Builder for this dispatch." }, { status: 400 });
  const builder = await getBuilder(builderId);
  if (!builder?.verifiedAt) {
    return NextResponse.json({ error: `Builder "${builderId}" must be verified before dispatch.` }, { status: 409 });
  }

  try {
    let attemptId: string;
    let cardTitle: string;
    let cardBrief: string;
    if (canonCard) {
      const commit = await commitCanonicalDispatch(canonCard, builderId);
      if (commit.kind === "error") return commit.response;
      attemptId = commit.attemptId;
      cardTitle = canonCard.Title;
      cardBrief = ""; // canonical cards carry no brief (privacy rule)
    } else {
      const card = legacyCard!;
      if (card.workflowStage === "backlog") {
        await transitionCard({ cardId, to: "todo", actor: "firstmate", note: "Accepted for dispatch." });
      }
      const refreshed = await getCard(cardId);
      if (refreshed?.workflowStage === "todo") {
        await transitionCard({ cardId, to: "doing", actor: "firstmate", note: `Dispatched to ${builder.name}.` });
      } else if (refreshed?.workflowStage !== "doing") {
        throw new KanbanStoreError(`Card must be in backlog, todo, or doing to dispatch; current stage is ${refreshed?.workflowStage}.`, 409);
      }

      const attempt = await createAttempt(cardId, {
        builderId,
        role: "builder",
        ...(builder.effort ? { effort: builder.effort } : {}),
      });
      attemptId = attempt.id;
      cardTitle = card.title;
      cardBrief = card.brief;
    }
    const attempt = { id: attemptId };
    const session = await createSession(cardTitle, builderId, {
      kind: "kanban", cardId, attemptId: attempt.id,
    });
    if (legacyCard) {
      await bindAttemptSession(cardId, attempt.id, session.id);
      await updateAttempt(cardId, attempt.id, {
        status: "running", startedAt: new Date().toISOString(),
      }, "system");
      await setRuntime(cardId, "running", "system", `${builder.name} is working.`);
      await ensureKanbanCommandMonitor();
      notifyKanbanActivityChanged();
    }

    // Legacy kanban-store runtime writes only apply to legacy cards; a
    // canonical card's runtime story is the runtime phase's job.
    const updateLegacyAttempt = async (patch: Record<string, unknown>, actor: "system" | "user") => {
      if (legacyCard) await updateAttempt(cardId, attempt.id, patch, actor).catch(() => {});
    };
    const setLegacyRuntime = async (state: "running" | "failed" | "needs_input" | "idle" | "stopped", actor: "system" | "user", note?: string) => {
      if (legacyCard) await setRuntime(cardId, state, actor, note).catch(() => {});
    };

    const commandFile = await commandFileForAttempt(attempt.id);
    const prompt = [
      `You are implementing Kanban card ${cardId}: ${cardTitle}.`,
      cardBrief ? `Brief:\n${cardBrief}` : "",
      "Work on the requested outcome using the current Agent OS workspace and report concrete results.",
      ...(legacyCard ? [
        "Workflow transitions are deterministic and do not require an API token.",
        `When implementation is genuinely ready for review, append exactly one JSON line to: ${commandFile}`,
        `Shape: {"id":"cmd-unique","at":"ISO timestamp","cardId":"${cardId}","attemptId":"${attempt.id}","type":"request_transition","to":"ready2review","note":"tests or evidence"}`,
        "Do not claim ready2review unless the work and its focused verification actually completed.",
      ] : [
        // Canonical card: the legacy command-file channel is not watched for
        // canonical attempts (runtime-phase territory), so don't send the
        // worker into a dead channel.
        "Report your concrete results in the final response; the review handoff is managed by the control plane.",
      ]),
    ].filter(Boolean).join("\n\n");

    const origin = new URL(req.url).origin;
    // Server-to-server dispatch authenticates with the server's own token. The
    // browser caller may hold only the HttpOnly session cookie (no header), so
    // echoing the caller's credential would forward an empty token.
    const token = getApiToken();
    const dispatchAbort = new AbortController();
    const abortFromClient = () => dispatchAbort.abort();
    req.signal.addEventListener("abort", abortFromClient, { once: true });
    activeDispatches.set(attempt.id, dispatchAbort);
    const upstream = await fetch(`${origin}/api/sen/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agentic-os-token": token,
        origin,
      },
      body: JSON.stringify({ prompt, builderId, session: session.id }),
      signal: dispatchAbort.signal,
    });
    if (!upstream.ok || !upstream.body) {
      const error = await upstream.json().catch(() => ({})) as { error?: string };
      await updateLegacyAttempt({
        status: "failed", endedAt: new Date().toISOString(),
        error: error.error ?? `Sen dispatch failed (${upstream.status}).`,
      }, "system");
      await setLegacyRuntime("failed", "system", error.error);
      // A canonical commit already created the attempt — surface its id so
      // the caller can reconcile instead of retrying blind (a retry would
      // 409 on the active attempt).
      return NextResponse.json({
        error: error.error ?? "Sen dispatch failed.",
        ...(canonCard ? { attemptId: attempt.id, canonical: true } : {}),
      }, { status: upstream.status || 502 });
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = upstream.body!.getReader();
        let buffer = "";
        let finalized = false;
        const send = (value: unknown) => {
          try { controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`)); } catch { /* closed */ }
        };
        send({ t: "attempt", cardId, attemptId: attempt.id, sessionId: session.id });
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            controller.enqueue(encoder.encode(chunk));
            buffer += chunk;
            let newline = -1;
            while ((newline = buffer.indexOf("\n")) >= 0) {
              const line = buffer.slice(0, newline).trim();
              buffer = buffer.slice(newline + 1);
              if (!line) continue;
              let event: Record<string, unknown>;
              try { event = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
              if (event.t === "activity") await setLegacyRuntime("running", "system", String(event.c ?? ""));
              if (event.t === "note" && /permission|waiting|input|question/i.test(String(event.c ?? ""))) {
                await updateLegacyAttempt({ status: "needs_input", note: String(event.c ?? "") }, "system");
                await setLegacyRuntime("needs_input", "system", String(event.c ?? ""));
              }
              if (event.t === "final") {
                finalized = true;
                const ok = event.ok === true;
                await updateLegacyAttempt({
                  status: ok ? "succeeded" : "failed",
                  endedAt: new Date().toISOString(),
                  ...(typeof event.model === "string" ? { actualModel: event.model } : {}),
                  ...(event.usage && typeof event.usage === "object"
                    ? { usage: event.usage as { input?: number; output?: number; thinking?: number } } : {}),
                  ...(!ok ? { error: String(event.error ?? "Worker failed.") } : {}),
                }, "system");
                await setLegacyRuntime(ok ? "idle" : "failed", "system",
                  ok ? `${builder.name} finished the turn.` : String(event.error ?? "Worker failed."));
              }
            }
          }
        } catch (error) {
          if (!finalized) {
            await updateLegacyAttempt({
              status: req.signal.aborted ? "stopped" : "failed",
              endedAt: new Date().toISOString(),
              error: String((error as Error)?.message ?? error),
            }, "system");
            await setLegacyRuntime(req.signal.aborted ? "stopped" : "failed", "system");
          }
        } finally {
          activeDispatches.delete(attempt.id);
          req.signal.removeEventListener("abort", abortFromClient);
          notifyKanbanActivityChanged();
          try { controller.close(); } catch { /* already closed */ }
        }
      },
      async cancel() {
        dispatchAbort.abort();
        await upstream.body?.cancel().catch(() => {});
        activeDispatches.delete(attempt.id);
        req.signal.removeEventListener("abort", abortFromClient);
        await updateLegacyAttempt({
          status: "stopped", endedAt: new Date().toISOString(), error: "Stopped by the user.",
        }, "system");
        await setLegacyRuntime("stopped", "system", "Stopped by the user.");
        notifyKanbanActivityChanged();
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-store, no-transform",
      },
    });
  } catch (error) {
    if (error instanceof KanbanStoreError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: String(error instanceof Error ? error.message : error) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });
  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Body must be JSON." }, { status: 400 }); }
  const cardId = typeof body.cardId === "string" ? body.cardId : "";
  const attemptId = typeof body.attemptId === "string" ? body.attemptId : "";
  const card = await getCard(cardId);
  const attempt = card?.attempts.find((entry) => entry.id === attemptId);
  if (!card || !attempt) return NextResponse.json({ error: "Attempt not found." }, { status: 404 });
  if (attempt.status !== "running" && attempt.status !== "needs_input" && attempt.status !== "queued") {
    return NextResponse.json({ error: "Only an active attempt can be stopped." }, { status: 409 });
  }
  // No raw PID is accepted or killed here. The transport stream owns its child
  // through the existing Sen runner; aborting its registered controller
  // invokes the runner's process-tree cleanup.
  activeDispatches.get(attemptId)?.abort();
  activeDispatches.delete(attemptId);
  await updateAttempt(cardId, attemptId, {
    status: "stopped", endedAt: new Date().toISOString(), error: "Stop requested.",
  }, "user");
  await setRuntime(cardId, "stopped", "user", "Stop requested.");
  notifyKanbanActivityChanged();
  return NextResponse.json({ ok: true, note: "The attempt handle is marked stopped; its active stream owns process cancellation." });
}
