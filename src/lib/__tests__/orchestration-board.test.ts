import assert from "node:assert/strict";
import { test } from "node:test";

import {
  addCounters,
  laneCounters,
  lifecycleCounters,
} from "../orchestration-board";

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
