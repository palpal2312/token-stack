import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";

import OrcaSlotStatus from "../../src/components/OrcaSlotStatus";
import {
  fixtureCapabilityError,
  fixtureCursorProjection,
  fixtureReconcileProjection,
  fixtureRuntimeSlots,
  LOADING_VIEW,
  parseRuntimeSlots,
  toSlotView,
} from "../../src/lib/agentRuntime/orca-slot-client";

/**
 * Sprint 04 Lane 2 — reconnect/reattach + observe-only UI render evidence.
 * Server-render only; no browser or dashboard required.
 */

function renderView(view: Parameters<typeof OrcaSlotStatus>[0]["view"]) {
  return renderToStaticMarkup(createElement(OrcaSlotStatus, { view }));
}

test("reconnecting projection renders reconnect banner and observe-only label", () => {
  const dto = parseRuntimeSlots(fixtureRuntimeSlots({ state: "running", builder_label: "Claude via Kimi" }));
  const view = toSlotView(dto!, "orca-lab-0", fixtureReconcileProjection({
    phase: "reconnecting",
    observe_only: true,
    reattach_count: 2,
    last_seq: 9,
    diagnostic: "transport gap",
  }));
  const html = renderView(view);
  assert.ok(html.includes("Reconnecting"));
  assert.ok(html.includes("Reconnect status") || html.includes("canonical slot replace") || html.includes("Transport reconnect"));
  assert.ok(html.includes("reattach ×2"));
  assert.ok(html.includes("seq 9"));
  assert.ok(html.includes("Observe-only diagnostics"));
  assert.ok(!/<(button|input|form)\b/.test(html), "status shell stays control-free");
});

test("reattaching projection shows Reattaching status text", () => {
  const dto = parseRuntimeSlots(fixtureRuntimeSlots({ state: "reconciling", reason: "fence" }));
  const view = toSlotView(dto!, "orca-lab-0", fixtureReconcileProjection({ phase: "reattaching" }));
  const html = renderView(view);
  assert.ok(html.includes("Reattaching"));
  assert.ok(html.includes("Reconnect status") || html.includes("Reattaching Run") || html.includes("Reattaching"));
});

test("steady available slot omits reconnect banner", () => {
  const dto = parseRuntimeSlots(fixtureRuntimeSlots({ state: "running", builder_label: "Claude" }));
  const view = toSlotView(dto!, "orca-lab-0", fixtureReconcileProjection({ phase: "steady", observe_only: false }));
  const html = renderView(view);
  assert.ok(html.includes("running") || html.includes("Claude"));
  assert.ok(!html.includes("Observe-only diagnostics"));
  assert.ok(!html.includes("Transport reconnect"));
});

test("loading placeholder still renders without reconcile chrome", () => {
  const html = renderView(LOADING_VIEW);
  assert.ok(html.includes("Loading"));
  assert.ok(!html.includes("reattach"));
});

test("quarantined projection renders error without mutation controls", () => {
  const dto = parseRuntimeSlots(fixtureRuntimeSlots({ state: "running" }));
  const view = toSlotView(dto!, "orca-lab-0", fixtureReconcileProjection({
    phase: "quarantined",
    diagnostic: "stale mismatch",
  }));
  const html = renderView(view);
  assert.ok(html.includes("Quarantined"));
  assert.ok(html.includes("stale mismatch"));
  assert.ok(!/<(button|input|form)\b/.test(html));
});

test("capability error + cursor render observe-only and no secret leakage", () => {
  const dto = parseRuntimeSlots(fixtureRuntimeSlots({ state: "running", builder_label: "Claude" }));
  const view = toSlotView(dto!, "orca-lab-0", fixtureReconcileProjection({ phase: "steady" }), {
    cursor: fixtureCursorProjection({ output_cursor: 12, dispatch_id: "ctx_active_9" }),
    capabilityError: fixtureCapabilityError({
      code: "capability_revoked",
      message: "capability revoked",
      attempt_dispatch_id: "ctx_fenced_1",
    }),
  });
  const html = renderView(view);
  assert.ok(html.includes("Capability error") || html.includes("capability revoked"));
  assert.ok(html.includes("cursor 12") || html.includes("ctx_active_9@12"));
  assert.ok(html.includes("Observe-only diagnostics"));
  assert.ok(!html.includes("sk-"));
  assert.ok(!html.includes("dcap_"));
  assert.ok(!/<(button|input|form)\b/.test(html));
});
