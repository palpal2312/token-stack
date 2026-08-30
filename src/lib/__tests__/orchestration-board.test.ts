import assert from "node:assert/strict";
import { test } from "node:test";

import {
  addCounters,
  deriveBoardCards,
  laneCounters,
  lifecycleCounters,
} from "../orchestration-board";
import type { MasterNote } from "../orchestration-notes";
import type { OrchestrationLaneView } from "../orchestration-state";

test("lifecycleCounters maps a dispatch state to one task", () => {
  assert.deepEqual(lifecycleCounters(undefined), { done: 0, active: 0, pending: 0 });
  assert.deepEqual(lifecycleCounters("IDLE"), { done: 0, active: 0, pending: 0 });
  assert.deepEqual(lifecycleCounters("RUNNING"), { done: 0, active: 1, pending: 0 });
  assert.deepEqual(lifecycleCounters("HOLD_LANE"), { done: 0, active: 1, pending: 0 });
  assert.deepEqual(lifecycleCounters("DISPATCHED"), { done: 0, active: 0, pending: 1 });
  assert.deepEqual(lifecycleCounters("DONE"), { done: 1, active: 0, pending: 0 });
});

test("addCounters merges task-lane and lifecycle counters", () => {
  assert.deepEqual(
    addCounters(laneCounters(["DONE", "QUEUED"]), lifecycleCounters("RUNNING")),
    { done: 1, active: 1, pending: 1 },
  );
});

test("deriveBoardCards renders one card per lifecycle lane with notes", () => {
  const lanes: OrchestrationLaneView[] = [
    {
      lane: "lane-a",
      task: "S09-X",
      currentState: "DONE",
      lastEventAt: "2026-08-30T00:00:00Z",
      timeline: [
        {
          lane: "lane-a",
          task: "S09-X",
          transition: "DONE",
          time: "2026-08-30T00:00:00Z",
          summary: "finished",
          writer: "lane-a",
        },
      ],
    },
    { lane: "community", task: "S09-Y", currentState: "DONE", timeline: [] },
  ];
  const notes: MasterNote[] = [
    { time: "2026-08-30T00:01:00Z", text: "ran checks", field: "run", lane: "lane-a", writer: "lane-a" },
  ];
  const cards = deriveBoardCards(lanes, notes);
  // One lifecycle lane in the journal -> one card; the domain lane attaches.
  assert.equal(cards.length, 1);
  const card = cards[0];
  assert.equal(card.track, "lane-a");
  assert.equal(card.status, "DONE");
  // one task-lane DONE + the lifecycle's own DONE dispatch
  assert.deepEqual(card.counters, { done: 2, active: 0, pending: 0 });
  assert.equal(card.memo, "finished");
  assert.equal(card.run, "ran checks");
  assert.equal(card.next, undefined);
  assert.deepEqual(card.lastWrite, { writer: "lane-a", time: "2026-08-30T00:00:00Z" });
});

test("deriveBoardCards prefers the current sprint's lanes", () => {
  const view = (lane: string, state: string): OrchestrationLaneView => ({
    lane,
    task: lane.toUpperCase(),
    currentState: state,
    timeline: [
      { lane, task: lane.toUpperCase(), transition: state as never, time: "2026-08-30T05:00:00Z", summary: "memo" },
    ],
  });
  const lanes = [
    view("lane-a", "DONE"),
    view("s10-readonly-canary", "RUNNING"),
    view("s10-evidence-gap-ledger", "DONE"),
  ];
  const scoped = deriveBoardCards(lanes, [], { currentSprint: 10 });
  assert.deepEqual(
    scoped.map((c) => c.laneId),
    ["s10-readonly-canary", "s10-evidence-gap-ledger"],
  );
  assert.equal(scoped[0].status, "WORKING");
  // Journal wins over stale markers: a regressed current sprint (9) still
  // shows the newest lanes in the journal, never the legacy Sprint-09 card.
  assert.deepEqual(
    deriveBoardCards(lanes, [], { currentSprint: 9 }).map((c) => c.laneId),
    ["s10-readonly-canary", "s10-evidence-gap-ledger"],
  );
  // No current sprint -> the latest sprint present in the journal.
  assert.deepEqual(
    deriveBoardCards(lanes, []).map((c) => c.laneId),
    ["s10-readonly-canary", "s10-evidence-gap-ledger"],
  );
  // Roadmap ahead of the journal (sprint 11 opened, no s11 lanes yet):
  // fall back to the most recent lanes the journal has, not an empty board.
  assert.deepEqual(
    deriveBoardCards(lanes, [], { currentSprint: 11 }).map((c) => c.laneId),
    ["s10-readonly-canary", "s10-evidence-gap-ledger"],
  );
});

test("deriveBoardCards scopes to a future sprint once its lanes exist", () => {
  const view = (lane: string, state: string): OrchestrationLaneView => ({
    lane,
    task: lane.toUpperCase(),
    currentState: state,
    timeline: [
      { lane, task: lane.toUpperCase(), transition: state as never, time: "2026-08-31T05:00:00Z", summary: "memo" },
    ],
  });
  const lanes = [
    view("lane-a", "DONE"),
    view("s10-readonly-canary", "DONE"),
    view("s11-future-lane", "RUNNING"),
  ];
  const scoped = deriveBoardCards(lanes, [], { currentSprint: 11 });
  assert.deepEqual(scoped.map((c) => c.laneId), ["s11-future-lane"]);
  assert.equal(scoped[0].status, "WORKING");
});
