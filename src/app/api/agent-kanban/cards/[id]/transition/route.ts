import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { KanbanStoreError, transitionCard } from "@/lib/agent-kanban/store";
import { isKanbanActor, isWorkflowStage } from "@/lib/agent-kanban/types";
import { goApiAvailable, goApiFetch } from "@/lib/goApiProxy";
import { goCardToWorkItem, type GoBoardSnapshot } from "@/lib/agent-kanban/go-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Canonical transition forwarding: read the current version from the canonical
// board, then forward the transition with an optimistic version check. When the
// Go listener is unavailable or the card is not canonical, the legacy store
// path handles it.
async function tryCanonicalTransition(id: string, body: Record<string, unknown>): Promise<NextResponse | null> {
  if (!(await goApiAvailable())) return null;
  const commandId = typeof body.commandId === "string" && body.commandId ? body.commandId : `transition-${id}-${crypto.randomUUID()}`;
  const board = await goApiFetch("/v1/kanban/board");
  if (!board.ok || !board.body || typeof board.body !== "object") return null;
  const card = ((board.body as GoBoardSnapshot).Cards ?? []).find((entry) => entry.TaskID === id);
  if (!card) return null; // not canonical yet — legacy path owns it
  const result = await goApiFetch(`/v1/kanban/tasks/${encodeURIComponent(id)}/transition`, {
    method: "POST",
    body: {
      commandId,
      to: body.to,
      expectedVersion: card.Version,
      actor: body.actor,
      ...(typeof body.note === "string" ? { note: body.note } : {}),
    },
  });
  // The card is canonical: never fall through to the legacy store after the
  // write may have been committed upstream — that would double-apply.
  if (result.unreachable) {
    return NextResponse.json({ error: "canonical transition may have been applied upstream; retry the command id" }, { status: 503 });
  }
  if (!result.ok) {
    // 5xx from the Go side is a server fault, not a client error — surface it
    // as 502/503 so a retry is understood as futile-or-deferred correctly.
    const code = result.status === 409 ? 409 : result.status === 404 ? 404 : result.status >= 500 ? 502 : 400;
    const message = (result.body as { message?: string } | null)?.message ?? "canonical transition failed";
    return NextResponse.json({ error: message }, { status: code });
  }
  const outcome = result.body as { taskId?: string; version?: number; stage?: string };
  // Return a full card (not a stub) so the UI's upsert path keeps every field.
  const fullCard = goCardToWorkItem({
    ...card,
    WorkflowStage: outcome.stage ?? card.WorkflowStage,
    UpdatedAt: new Date().toISOString(),
  });
  return NextResponse.json({
    card: fullCard,
    version: outcome.version,
    duplicate: false,
    canonical: true,
  });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const { id } = await ctx.params;
  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Body must be JSON." }, { status: 400 }); }
  if (!isWorkflowStage(body.to) || !isKanbanActor(body.actor)) {
    return NextResponse.json({ error: "A valid to stage and actor are required." }, { status: 400 });
  }
  try {
    const canonical = await tryCanonicalTransition(id, body);
    if (canonical) return canonical;
    const result = await transitionCard({
      cardId: id,
      to: body.to,
      actor: body.actor,
      ...(typeof body.note === "string" ? { note: body.note } : {}),
      ...(typeof body.commandId === "string" ? { commandId: body.commandId } : {}),
      ...(typeof body.attemptId === "string" ? { attemptId: body.attemptId } : {}),
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof KanbanStoreError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: String(error instanceof Error ? error.message : error) }, { status: 500 });
  }
}

