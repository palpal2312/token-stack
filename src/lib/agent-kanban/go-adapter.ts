// Shape adaptation between the canonical Go kanban API and the legacy
// agent-kanban card shape the dashboard UI consumes. The Go side returns
// BoardSnapshot{Cards, ProjectionVer, LastAppliedSeq} with PascalCase keys;
// the UI expects {cards: WorkItem[]} with the legacy field names.
//
// This adapter is the only place the two shapes meet — both directions are
// lossy by design and documented per field.

import type { KanbanEvent, WorkItem } from "./types";
import { goApiAvailable, goApiFetch } from "@/lib/goApiProxy";

export interface GoKanbanCard {
  TaskID: string;
  GoalID: string;
  WorkflowStage: string;
  RuntimeState: string;
  ActiveAttemptID?: string;
  Title: string;
  BuilderID?: string;
  Version: number;
  UpdatedAt: string;
}

export interface GoBoardSnapshot {
  Cards: GoKanbanCard[] | null;
  ProjectionVer: string;
  LastAppliedSeq: number;
}

/** Map a canonical projection card to the legacy WorkItem the UI renders. */
export function goCardToWorkItem(card: GoKanbanCard): WorkItem {
  return {
    id: card.TaskID,
    title: card.Title,
    brief: "",
    workflowStage: (card.WorkflowStage || "backlog") as WorkItem["workflowStage"],
    runtimeState: (card.RuntimeState || "idle") as WorkItem["runtimeState"],
    source: { kind: "import" },
    attempts: [],
    ...(card.ActiveAttemptID ? { activeAttemptId: card.ActiveAttemptID } : {}),
    links: {},
    createdAt: card.UpdatedAt,
    updatedAt: card.UpdatedAt,
    stageChangedAt: card.UpdatedAt,
  };
}

export function goBoardToCards(snapshot: GoBoardSnapshot): WorkItem[] {
  return (snapshot.Cards ?? []).map(goCardToWorkItem);
}

// Canonical activity entries (PascalCase, from GET /v1/kanban/activity) carry
// no event payload — the canonical spine records the task snapshot, not the
// legacy note/to fields. The UI's eventText falls back to the type label, so
// canonical-sourced activity renders as e.g. "workflow transition".
export interface GoActivityEntry {
  Seq: number;
  TaskID: string;
  Kind: string;
  Actor: string;
  At: string;
  AttemptID?: string;
}

export interface GoActivityResponse {
  activity: GoActivityEntry[] | null;
  projectionVersion: string;
}

const LEGACY_EVENT_TYPES: ReadonlySet<string> = new Set([
  "card_created", "card_updated", "card_deleted", "workflow_transition",
  "runtime_changed", "attempt_created", "attempt_updated", "migration_applied",
]);
const LEGACY_ACTORS: ReadonlySet<string> = new Set(["user", "firstmate", "owner", "reviewer", "system"]);

/** Map canonical activity to legacy events, failing closed on unknown kinds. */
export function goActivityToKanbanEvents(entries: GoActivityEntry[]): KanbanEvent[] {
  const out: KanbanEvent[] = [];
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.Seq) || entry.Seq < 1) continue;
    if (!LEGACY_EVENT_TYPES.has(entry.Kind)) continue;
    out.push({
      seq: entry.Seq,
      id: `go-activity-${entry.Seq}`,
      at: typeof entry.At === "string" ? entry.At : "",
      type: entry.Kind as KanbanEvent["type"],
      actor: (LEGACY_ACTORS.has(entry.Actor) ? entry.Actor : "system") as KanbanEvent["actor"],
      ...(entry.TaskID ? { cardId: entry.TaskID } : {}),
      ...(entry.AttemptID ? { attemptId: entry.AttemptID } : {}),
      payload: {},
    });
  }
  return out;
}

/**
 * Fetch projected Kanban board state from the Go control plane / daemon endpoint when authority is enabled.
 * Checks SEN_GO_BUILDER_EXEC_AUTHORITY=1 or goApiAvailable().
 */
export async function fetchGoKanbanBoard(): Promise<GoBoardSnapshot | null> {
  const useGoAuthority = process.env.SEN_GO_BUILDER_EXEC_AUTHORITY === "1" || (await goApiAvailable());
  if (!useGoAuthority) return null;

  const result = await goApiFetch("/v1/kanban/board");
  if (result.ok && result.body && typeof result.body === "object") {
    return result.body as GoBoardSnapshot;
  }

  // Direct daemon fallback route: GET /api/v1/kanban/board on daemon port 3738
  try {
    const daemonRes = await fetch("http://127.0.0.1:3738/api/v1/kanban/board", {
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(5_000),
    });
    if (daemonRes.ok) {
      const body = await daemonRes.json().catch(() => null);
      if (body && typeof body === "object") {
        return body as GoBoardSnapshot;
      }
    }
  } catch {
    // Daemon endpoint not reachable
  }

  return null;
}
