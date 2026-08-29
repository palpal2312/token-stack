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

/**
 * Lane card counters: how a lane is consuming its task list. `active` = tasks
 * in flight (dispatched/running/waiting), `pending` = queued or interrupted
 * tasks still unfinished, `done` = finished. Lets the master see parallelism
 * and laziness (pending > 0 with no active) at a glance.
 */
export interface LaneCounters {
  done: number;
  active: number;
  pending: number;
}

const ACTIVE_STATES = new Set(["DISPATCHED", "RUNNING", "WAITING_ON"]);
const DONE_STATES = new Set(["DONE"]);

export function laneCounters(states: readonly string[]): LaneCounters {
  let done = 0;
  let active = 0;
  let pending = 0;
  for (const state of states) {
    if (ACTIVE_STATES.has(state)) active += 1;
    else if (DONE_STATES.has(state)) done += 1;
    else pending += 1;
  }
  return { done, active, pending };
}

/**
 * Card status. An explicit lane-lifecycle event (IDLE, RUNNING, HOLD_x, DONE)
 * wins;
 * otherwise the counters decide: any active -> ACTIVE, pending-only ->
 * IDLE_WITH_WORK (needs a nudge), finished -> DONE, nothing -> IDLE.
 */
export function deriveCardStatus(
  counters: LaneCounters,
  lifecycle?: string,
): string {
  if (lifecycle && lifecycle.startsWith("HOLD_")) return lifecycle;
  if (lifecycle === "RUNNING") return "ACTIVE";
  if (lifecycle === "DONE" && counters.pending > 0) return "IDLE_WITH_WORK";
  if (lifecycle) return lifecycle; // IDLE, DONE, HOLD_*
  if (counters.active > 0) return "ACTIVE";
  if (counters.pending > 0) return "IDLE_WITH_WORK";
  if (counters.done > 0) return "DONE";
  return "IDLE";
}