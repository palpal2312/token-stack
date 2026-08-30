import assert from "node:assert/strict";
import test from "node:test";
import { ESCAPE_KEY, FOCUSABLE_SELECTOR, stepFocusTrap } from "../../src/shell/focus-trap";
import { navProgressLiveText, routeLabel } from "../../src/shell/live-region-text";

// --- focus-trap policy ------------------------------------------------

test("focus-trap: single or no focusable stays put (nothing to wrap)", () => {
  assert.deepEqual(stepFocusTrap(0, 0, false), { kind: "stay" });
  assert.deepEqual(stepFocusTrap(0, 0, true), { kind: "stay" });
  assert.deepEqual(stepFocusTrap(1, 0, false), { kind: "stay" });
  assert.deepEqual(stepFocusTrap(1, 0, true), { kind: "stay" });
});

test("focus-trap: Tab past the last focusable wraps to the first", () => {
  assert.deepEqual(stepFocusTrap(3, 2, false), { kind: "wrap-first" });
  assert.deepEqual(stepFocusTrap(3, 1, false), { kind: "stay" }); // middle — native
});

test("focus-trap: Shift+Tab before the first focusable wraps to the last", () => {
  assert.deepEqual(stepFocusTrap(3, 0, true), { kind: "wrap-last" });
  assert.deepEqual(stepFocusTrap(3, 1, true), { kind: "stay" }); // middle — native
});

test("focus-trap: an out-of-range index is treated as entering the trap (stay forward / wrap backward)", () => {
  assert.deepEqual(stepFocusTrap(3, -1, false), { kind: "stay" });
  assert.deepEqual(stepFocusTrap(3, -1, true), { kind: "wrap-last" });
});

test("focus-trap: stable Escape key + focusable selector surface", () => {
  assert.equal(ESCAPE_KEY, "Escape");
  assert.match(FOCUSABLE_SELECTOR, /button:not\(\[disabled\]\)/);
  assert.match(FOCUSABLE_SELECTOR, /\[tabindex\]:not\(\[tabindex="-1"\]\)/);
});

// --- live-region text mapping -----------------------------------------

test("live-region: route labels titleize segments", () => {
  assert.equal(routeLabel("/"), "Home");
  assert.equal(routeLabel(""), "Home");
  assert.equal(routeLabel("/agent-kanban"), "Agent Kanban");
  assert.equal(routeLabel("/code-space"), "Code Space");
  assert.equal(routeLabel("/sen"), "Sen");
});

test("live-region: nav start/arrival text reflects the step", () => {
  assert.equal(navProgressLiveText("start", "/agent-kanban"), "Loading Agent Kanban");
  assert.equal(navProgressLiveText("arrived", "/sen"), "Arrived at Sen");
  assert.equal(navProgressLiveText("start", "/"), "Loading Home");
});