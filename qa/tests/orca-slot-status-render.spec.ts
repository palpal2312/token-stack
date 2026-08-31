import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";

import OrcaSlotStatus from "../../src/components/OrcaSlotStatus";
import { fixtureRuntimeSlots, LOADING_VIEW, parseRuntimeSlots, toSlotView } from "../../src/lib/agentRuntime/orca-slot-client";

// Server-render the component against fixture views and assert the HTML carries
// only safe fields. Complements orca-slot-status.spec.ts (model-level) with a
// real render pass — no browser or dev server required.

function render(state: string) {
  const dto = parseRuntimeSlots(fixtureRuntimeSlots({
    state: state as never,
    in_flight: state === "running" ? 1 : 0,
    builder_label: state === "running" ? "Claude via Kimi" : null,
    attempt_ref: state === "running" ? "attempt-7" : null,
    reason: state === "reconciling" ? "stale fence observed" : null,
  }));
  return renderToStaticMarkup(createElement(OrcaSlotStatus, { view: toSlotView(dto!, "orca-lab-0") }));
}

test("renders every state without throwing", () => {
  for (const state of ["free", "reserved", "launching", "running", "reconciling", "draining"]) {
    const html = render(state);
    assert.ok(html.includes("Orca Lab slot"), state);
  }
});

test("running render shows label, WIP, attempt ref, observation time", () => {
  const html = render("running");
  assert.ok(html.includes("Claude via Kimi"));
  assert.ok(html.includes("WIP 1/1"));
  assert.ok(html.includes("Attempt attempt-7"));
  assert.ok(html.includes("2026-08-18"));
});

test("drifted render shows the safe reason; disabled and loading render placeholders", () => {
  assert.ok(render("reconciling").includes("stale fence observed"));
  const disabled = renderToStaticMarkup(createElement(OrcaSlotStatus, {
    view: toSlotView(parseRuntimeSlots(fixtureRuntimeSlots({}, false)), "orca-lab-0"),
  }));
  assert.ok(disabled.includes("Orca Lab disabled"));
  assert.ok(!disabled.includes("WIP 1/1"), "disabled must not show slot detail");
  const loading = renderToStaticMarkup(createElement(OrcaSlotStatus, { view: LOADING_VIEW }));
  assert.ok(loading.includes("Loading"));
});

test("rendered HTML contains no control elements and no secret-shaped content", () => {
  const html = render("running");
  assert.ok(!/<(button|input|form|a)\b/.test(html), "read-only shell must render no controls");
  assert.ok(!html.includes("sk-"), "no token-shaped content");
  assert.ok(!html.includes("C:\\"), "no paths");
});
