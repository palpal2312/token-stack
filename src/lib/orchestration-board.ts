/**
 * Browser-safe board projection for the orchestration dashboard.
 *
 * Pure constants and helpers only — no node imports — so client components
 * may bundle this without pulling in node:fs. The state-machine journal in
 * orchestration-state.ts keeps `lane` as the domain chain; this module maps a
 * domain lane to a physical Sprint 09 track (A/B/C) and to a kanban column
 * (To Do / In Progress / Done) derived from the journal state.
 */

// Type-only imports keep this module browser-safe (erased at compile time).
import type { MasterNote } from "./orchestration-notes";
import type { OrchestrationLaneView } from "./orchestration-state";

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
 * The lifecycle lane's current dispatch counts as one task on its card too,
 * so a lane's own jobs move done/active/pending (RUNNING/HOLD = active,
 * DISPATCHED = pending, DONE = done, IDLE/absent = nothing). Ceiling: this
 * reflects the latest dispatch, not the lane's job history — add a per-event
 * tally if totals ever matter.
 */
export function lifecycleCounters(state?: string): LaneCounters {
  if (!state || state === "IDLE") return { done: 0, active: 0, pending: 0 };
  if (state === "DONE") return { done: 1, active: 0, pending: 0 };
  if (state === "DISPATCHED") return { done: 0, active: 0, pending: 1 };
  return { done: 0, active: 1, pending: 0 };
}

export function addCounters(a: LaneCounters, b: LaneCounters): LaneCounters {
  return { done: a.done + b.done, active: a.active + b.active, pending: a.pending + b.pending };
}

/** Physical lifecycle lane id per track — the three lane cards. */
export const TRACK_LANE_IDS: Record<BoardTrack, string> = {
  A: "lane-a",
  B: "lane-b",
  C: "lane-c",
};

export const LANE_ID_SET = new Set(Object.values(TRACK_LANE_IDS));

/** Everything a lane card shows, derived once so the API and the page agree. */
export interface BoardCard {
  track: BoardTrack;
  laneId: string;
  status: string;
  counters: LaneCounters;
  /** Raw lifecycle state of the lane (RUNNING, DONE, HOLD_x, IDLE...). */
  lifecycle?: string;
  /** Summary of the lane's latest lifecycle event (the card's italic memo). */
  memo?: string;
  prerequisite?: string;
  lastEventAt?: string;
  lastWrite?: { writer: string; time?: string };
  /** Latest run/next lane note text (the two note boxes on the card). */
  run?: string;
  next?: string;
}

export function deriveBoardCards(
  lanes: readonly OrchestrationLaneView[],
  notes: readonly MasterNote[],
): BoardCard[] {
  return (Object.keys(TRACK_LANE_IDS) as BoardTrack[]).map((track) => {
    const laneId = TRACK_LANE_IDS[track];
    const lifecycle = lanes.find((l) => l.lane === laneId);
    const taskLanes = lanes.filter(
      (l) => l.lane !== laneId && trackForLane(l.lane) === track,
    );
    const counters = addCounters(
      laneCounters(taskLanes.map((l) => l.currentState)),
      lifecycleCounters(lifecycle?.currentState),
    );
    const lastEvent = lifecycle?.timeline[lifecycle.timeline.length - 1];
    const latestLaneNote = (field: string) =>
      [...notes].reverse().find((n) => n.lane === laneId && n.field === field);
    return {
      track,
      laneId,
      status: deriveCardStatus(counters, lifecycle?.currentState),
      counters,
      lifecycle: lifecycle?.currentState,
      memo: lastEvent?.summary,
      prerequisite: lifecycle?.prerequisite,
      lastEventAt: lifecycle?.lastEventAt,
      lastWrite: lastEvent
        ? { writer: lastEvent.writer ?? laneId, time: lifecycle?.lastEventAt }
        : undefined,
      run: latestLaneNote("run")?.text,
      next: latestLaneNote("next")?.text,
    };
  });
}

/**
 * Card status. WORKING = the lane is running a task (lifecycle RUNNING, or
 * tasks in flight). ACTIVE = Orca called the lane and it has not answered yet
 * (lifecycle DISPATCHED). HOLD_x = stalled with a reason, IDLE_WITH_WORK =
 * work left but nobody on it (needs a nudge), DONE = finished, IDLE = empty.
 */
export function deriveCardStatus(
  counters: LaneCounters,
  lifecycle?: string,
): string {
  if (lifecycle && lifecycle.startsWith("HOLD_")) return lifecycle;
  if (lifecycle === "RUNNING") return "WORKING";
  if (lifecycle === "DISPATCHED") return "ACTIVE";
  if (lifecycle === "DONE" && counters.pending > 0) return "IDLE_WITH_WORK";
  if (lifecycle) return lifecycle; // IDLE, DONE, HOLD_*
  if (counters.active > 0) return "WORKING";
  if (counters.pending > 0) return "IDLE_WITH_WORK";
  if (counters.done > 0) return "DONE";
  return "IDLE";
}