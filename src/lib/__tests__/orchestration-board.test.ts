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

test("deriveBoardCards merges lifecycle, task lanes and lane notes", () => {
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
  assert.equal(cards.length, 3);
  const card = cards[0];
  assert.equal(card.track, "A");
  assert.equal(card.status, "DONE");
  // one task-lane DONE + the lifecycle's own DONE dispatch
  assert.deepEqual(card.counters, { done: 2, active: 0, pending: 0 });
  assert.equal(card.memo, "finished");
  assert.equal(card.run, "ran checks");
  assert.equal(card.next, undefined);
  assert.deepEqual(card.lastWrite, { writer: "lane-a", time: "2026-08-30T00:00:00Z" });
});
