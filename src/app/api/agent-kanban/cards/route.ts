import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import {
  createCard,
  KanbanStoreError,
  listCards,
  migrateLegacyCards,
} from "@/lib/agent-kanban/store";
import { isRuntimeState, isWorkflowStage, type KanbanSource } from "@/lib/agent-kanban/types";
import { goApiAvailable, goApiFetch } from "@/lib/goApiProxy";
import { goBoardToCards, fetchGoKanbanBoard, type GoBoardSnapshot } from "@/lib/agent-kanban/go-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function failed(error: unknown): NextResponse {
  if (error instanceof KanbanStoreError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json({ error: String(error instanceof Error ? error.message : error) }, { status: 500 });
}

export async function GET(req: Request) {
  const guard = checkLocalRequest(req, { requireJson: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });
  try {
    // Canonical-first: read projected board via go-adapter helper when SEN_GO_BUILDER_EXEC_AUTHORITY=1
    // or when go control plane API is available.
    const goSnapshot = await fetchGoKanbanBoard();
    if (goSnapshot) {
      return NextResponse.json(
        { cards: goBoardToCards(goSnapshot) },
        { headers: { "cache-control": "no-store", "x-kanban-source": "canonical" } },
      );
    }
    return NextResponse.json(
      { cards: await listCards() },
      { headers: { "cache-control": "no-store", "x-kanban-source": "legacy-fallback" } },
    );
  } catch (error) { return failed(error); }
}

export async function POST(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });
  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Body must be JSON." }, { status: 400 }); }

  try {
    if (body.op === "migrate") {
      if (typeof body.migrationId !== "string" || !Array.isArray(body.cards)) {
        return NextResponse.json({ error: "migrationId and cards[] are required." }, { status: 400 });
      }
      return NextResponse.json(await migrateLegacyCards(body.migrationId, body.cards));
    }

    const sourceBody = body.source && typeof body.source === "object"
      ? body.source as Record<string, unknown> : null;
    const kind = sourceBody?.kind;
    const source: KanbanSource = {
      kind: kind === "firstmate" || kind === "planner" || kind === "import" ? kind : "manual",
      ...(typeof sourceBody?.sessionId === "string" ? { sessionId: sourceBody.sessionId } : {}),
    };

    // Canonical create engages only when the caller names a goal — legacy
    // creates have no goal context and stay on the legacy store until the SEN
    // handoff supplies canonical goal ids.
    const goalId = typeof body.goalId === "string" ? body.goalId : "";
    if (goalId && (await goApiAvailable())) {
      const commandId = typeof body.commandId === "string" && body.commandId
        ? body.commandId
        : `create-${crypto.randomUUID()}`;
      const result = await goApiFetch("/v1/kanban/tasks", {
        method: "POST",
        body: {
          commandId,
          goalId,
          title: String(body.title ?? ""),
          actor: source.kind === "firstmate" ? "firstmate" : "user",
          // briefRef is a reference, not raw content — pass through only an
          // explicit reference field (phase-09 privacy rule).
          ...(typeof body.briefRef === "string" && body.briefRef ? { briefRef: body.briefRef } : {}),
        },
      });
      if (result.unreachable) {
        return NextResponse.json(
          { error: "canonical create may have been applied upstream; retry with this command id", commandId },
          { status: 503 },
        );
      }
      if (result.ok && result.body && typeof result.body === "object") {
        const outcome = result.body as { taskId?: string; version?: number; stage?: string };
        const at = new Date().toISOString();
        return NextResponse.json({
          card: {
            id: outcome.taskId,
            title: String(body.title ?? ""),
            brief: "",
            workflowStage: outcome.stage ?? "backlog",
            runtimeState: "idle",
            source,
            attempts: [],
            links: {},
            createdAt: at,
            updatedAt: at,
            stageChangedAt: at,
          },
          version: outcome.version,
          canonical: true,
        }, { status: 201 });
      }
      const code = result.status === 409 ? 409 : result.status === 404 ? 404 : result.status >= 500 ? 502 : 400;
      const message = (result.body as { message?: string } | null)?.message ?? "canonical create failed";
      return NextResponse.json({ error: message }, { status: code });
    }

    const card = await createCard({
      title: String(body.title ?? ""),
      brief: String(body.brief ?? ""),
      source,
      ...(isWorkflowStage(body.workflowStage) ? { workflowStage: body.workflowStage } : {}),
      ...(isRuntimeState(body.runtimeState) ? { runtimeState: body.runtimeState } : {}),
      ...(body.links && typeof body.links === "object" ? { links: body.links as Record<string, string> } : {}),
      ...(typeof body.note === "string" ? { note: body.note } : {}),
    }, source.kind === "firstmate" ? "firstmate" : "user");
    return NextResponse.json({ card }, { status: 201 });
  } catch (error) { return failed(error); }
}

