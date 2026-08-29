/**
 * Browser-safe board projection for the orchestration dashboard.
 *
 * Pure constants and helpers only — no node imports — so client components
 * may bundle this without pulling in node:fs. The state-machine journal in
 * orchestration-state.ts keeps `lane` as the domain chain; this module maps a
 * domain lane to a physical Sprint 09 track (A/B/C) and to a kanban column
 * (To Do / In Progress / Done) derived from the journal state.
 */

/** Journal terminal/active states (mirrored from the state machine). */
type OrchestrationState =
  | "QUEUED"
  | "DISPATCHED"
  | "RUNNING"
  | "WAITING_ON"
  | "DONE"
  | "BLOCKED"
  | "FAILED";

export type BoardTrack = "A" | "B" | "C";
export type BoardColumn = "todo" | "in-progress" | "done";

export const BOARD_COLUMNS: readonly BoardColumn[] = ["todo", "in-progress", "done"];

/** Domain lane -> physical track (Sprint 09 lanes). Unknown domains land on C. */
export const LANE_TRACKS: Record<string, BoardTrack> = {
  "community-intake": "A",
  "community": "A",
  "snapshot-return": "A",
  "controlled-delivery": "B",
  "integration-baseline": "C",
  "dto-drift": "C",
  "orchestration-dashboard": "C",
  "contract": "C",
};

export function trackForLane(lane: string): BoardTrack {
  return LANE_TRACKS[lane] ?? "C";
}

export function columnForState(state: OrchestrationState | "INIT"): BoardColumn {
  switch (state) {
    case "QUEUED":
      return "todo";
    case "DISPATCHED":
    case "RUNNING":
    case "WAITING_ON":
      return "in-progress";
    default:
      return "done";
  }
}