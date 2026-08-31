import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createPanelResizeController,
  fixedBounds,
  KEYBOARD_STEP_PX,
  KEYBOARD_SHIFT_STEP_PX,
} from "./panel-resize-controller";
import { PANEL_MIN_SIZE, PANEL_MAX_SIZE } from "./panel-layout-store";

/** Queue-based rAF stand-in: `schedule` queues, `flush` runs queued frames FIFO. */
function createHarness(containerSize = 1000) {
  const writes: number[] = [];
  const commits: number[] = [];
  const queue: Array<() => void> = [];
  let currentContainer = containerSize;
  const controller = createPanelResizeController({
    onSize: (v) => void writes.push(v),
    onCommit: (v) => void commits.push(v),
    bounds: () => fixedBounds(PANEL_MIN_SIZE, PANEL_MAX_SIZE, currentContainer),
    schedule: (fn) => void queue.push(fn),
  });
  return {
    controller,
    writes,
    commits,
    queued: () => queue.length,
    flush: () => {
      while (queue.length) queue.shift()!();
    },
    setContainer: (n: number) => {
      currentContainer = n;
    },
  };
}

test("clamps drag geometry and batches many pointer moves into one flush", () => {
  const h = createHarness();

  // beginDrag captures the pointer, clamps, but never touches the DOM.
  h.controller.beginDrag(380, 41);
  assert.equal(h.controller.isDragging(), true);
  assert.equal(h.controller.pointerId(), 41);
  assert.equal(h.writes.length, 0);

  // 30 moves pushing far beyond the max still schedule exactly ONE frame.
  for (let i = 0; i < 30; i++) {
    h.controller.updateDrag(100 + i * 200, 100, 380);
  }
  assert.equal(h.queued(), 1, "at most one scheduled flush for many moves");
  assert.equal(h.writes.length, 0, "no DOM write until the frame flush");

  h.flush();
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0], PANEL_MAX_SIZE, "proposed size is clamped at the max");

  // A move far below the min clamps up to the min.
  h.controller.updateDrag(-5000, 100, 380);
  h.flush();
  assert.equal(h.writes[1], PANEL_MIN_SIZE, "proposed size is clamped at the min");

  // endDrag commits the applied size exactly once and releases the pointer.
  h.controller.endDrag();
  assert.equal(h.commits.length, 1);
  assert.equal(h.commits[0], PANEL_MIN_SIZE);
  assert.equal(h.controller.isDragging(), false);
  assert.equal(h.controller.pointerId(), null);
});

test("guards: moves before drag, resize mid-drag, and resize-during-write are all no-ops", () => {
  const h = createHarness();

  // updateDrag before any drag is ignored.
  h.controller.updateDrag(500, 100, 380);
  assert.equal(h.writes.length, 0);

  // A container-resize notification during a drag is suppressed (loop guard).
  h.controller.beginDrag(380, 7);
  assert.equal(h.controller.onContainerResize(), false);
  assert.equal(h.queued(), 0);
  h.controller.endDrag();
  assert.equal(h.commits.length, 1);
  assert.equal(h.commits[0], 380);
  h.flush(); // stale flush from endDrag must no-op

  // Re-entrant onContainerResize during the controller's own onSize write is ignored.
  let reentrantResult: boolean | null = null;
  let written = 0;
  const queueB: Array<() => void> = [];
  const c = createPanelResizeController({
    onSize: (v) => {
      written = v;
      reentrantResult = c.onContainerResize();
    },
    onCommit: () => {},
    bounds: () => fixedBounds(PANEL_MIN_SIZE, PANEL_MAX_SIZE, 1000),
    schedule: (fn) => void queueB.push(fn),
  });
  c.beginDrag(380, 9);
  c.updateDrag(900, 100, 380);
  while (queueB.length) queueB.shift()!();
  assert.equal(written, PANEL_MAX_SIZE);
  assert.equal(reentrantResult, false, "own write suppresses the observer echo");
  assert.equal(queueB.length, 0, "no bounce-back flush is scheduled");
});

test("keyboardStep clamps and commits; container resize re-clamps a stale applied size", () => {
  const h = createHarness();

  // Fine arrow step.
  const fine = h.controller.keyboardStep(380, 1, false);
  assert.equal(fine, 380 + KEYBOARD_STEP_PX);

  // Shift-arrow step clamps at the max (380 -> wait, base 700 + 160 = 860 -> 720).
  const coarse = h.controller.keyboardStep(700, 1, true);
  assert.equal(coarse, PANEL_MAX_SIZE);
  assert.equal(coarse, 700 + KEYBOARD_SHIFT_STEP_PX > PANEL_MAX_SIZE ? PANEL_MAX_SIZE : 700 + KEYBOARD_SHIFT_STEP_PX);
  assert.deepEqual([...h.commits], [fine, coarse]);

  // Container shrinks below the applied size: notification re-writes the clamped size.
  h.setContainer(300);
  assert.equal(h.controller.onContainerResize(), true);
  h.flush();
  assert.equal(h.writes[h.writes.length - 1], 300, "stale size is re-clamped to the container");

  // No change: notification schedules nothing.
  assert.equal(h.controller.onContainerResize(), false);
  assert.equal(h.queued(), 0);
});