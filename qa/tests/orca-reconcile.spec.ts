import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceCursor,
  classifyCapabilityReason,
  fixtureCapabilityError,
  fixtureCursorProjection,
  fixtureReconcileProjection,
  fixtureRuntimeSlots,
  parseCapabilityError,
  parseCursorProjection,
  parseReconcileProjection,
  parseRuntimeSlots,
  reconnectHintFor,
  toSlotView,
} from "../../src/lib/agentRuntime/orca-slot-client";
import { queryKeys } from "../../src/lib/query/query-keys";
import { QueryClient } from "../../src/lib/query/query-cache";
import { RealtimeReconciler } from "../../src/lib/query/realtime-reconciler";

/**
 * Sprint 04 Lane 2 — typed Orca reconcile/reattach projections + transport
 * reconnect helper. Pure node:test; no browser / daemon.
 */

test("parseReconcileProjection allowlists safe fields and drops secrets", () => {
  const raw = {
    phase: "reconnecting",
    last_seq: 12,
    last_reconcile_at: "2026-08-25T12:00:00.000Z",
    reattach_count: 2,
    observe_only: true,
    diagnostic: "gap after fence",
    token: "sk-secret-value",
    command: "claude --dangerous",
  };
  const dto = parseReconcileProjection(raw);
  assert.ok(dto);
  assert.equal(dto.phase, "reconnecting");
  assert.equal(dto.last_seq, 12);
  assert.equal(dto.reattach_count, 2);
  assert.equal(dto.observe_only, true);
  const wire = JSON.stringify(dto);
  assert.ok(!wire.includes("sk-secret-value"));
  assert.ok(!wire.includes("--dangerous"));
});

test("malformed reconcile projections fail closed", () => {
  assert.equal(parseReconcileProjection(null), null);
  assert.equal(parseReconcileProjection({}), null);
  assert.equal(parseReconcileProjection({ phase: "bogus", last_seq: 0, last_reconcile_at: null, reattach_count: 0, observe_only: true, diagnostic: null }), null);
  assert.equal(parseReconcileProjection(fixtureReconcileProjection({ reattach_count: -1 })), null);
  assert.equal(parseReconcileProjection(fixtureReconcileProjection({ diagnostic: "x".repeat(500) })), null);
});

test("toSlotView maps reconnecting/reattaching to drifted with reconnect hint", () => {
  const slots = parseRuntimeSlots(fixtureRuntimeSlots({ state: "running", builder_label: "Claude" }));
  assert.ok(slots);
  const reconnecting = toSlotView(slots, "orca-lab-0", fixtureReconcileProjection({ phase: "reconnecting", last_seq: 3 }));
  assert.equal(reconnecting.status, "drifted");
  assert.equal(reconnecting.statusText, "Reconnecting");
  assert.match(reconnecting.reconnectHint ?? "", /canonical slot replace/i);
  assert.equal(reconnecting.reconcile?.last_seq, 3);

  const reattaching = toSlotView(slots, "orca-lab-0", fixtureReconcileProjection({ phase: "reattaching", reattach_count: 1 }));
  assert.equal(reattaching.status, "drifted");
  assert.equal(reattaching.statusText, "Reattaching");
  assert.match(reattaching.reconnectHint ?? "", /Reattaching Run/i);
});

test("quarantined reconcile maps to error; observe_only keeps available with hint", () => {
  const slots = parseRuntimeSlots(fixtureRuntimeSlots({ state: "running" }));
  const quarantined = toSlotView(slots!, "orca-lab-0", fixtureReconcileProjection({
    phase: "quarantined",
    diagnostic: "stale fence",
  }));
  assert.equal(quarantined.status, "error");
  assert.equal(quarantined.statusText, "Quarantined");
  assert.equal(quarantined.reason, "stale fence");

  const observe = toSlotView(slots!, "orca-lab-0", fixtureReconcileProjection({ phase: "observe_only" }));
  assert.equal(observe.status, "available");
  assert.match(observe.reconnectHint ?? "", /Observe-only/i);
});

test("reconnectHintFor covers daemon reconciling without projection", () => {
  assert.match(reconnectHintFor(null, "reconciling") ?? "", /Daemon reconciling/);
  assert.equal(reconnectHintFor("steady", "running"), null);
});

test("notifyTransportReconnect schedules immediate gap-class refetch", () => {
  const client = new QueryClient();
  const r = new RealtimeReconciler({ workspaceId: "wsA", client, now: () => 1000 });
  const key = queryKeys.runtime.snapshot("wsA");

  const entry = r.notifyTransportReconnect([key]);
  assert.equal(entry.cause, "gap");
  assert.equal(entry.delayMs, 0);
  assert.equal(entry.dueAt, 1000);
  assert.deepEqual(entry.keys, [key]);
  assert.equal(r.scheduledEntries().length, 1);

  // Intervening deltas stay held while awaiting canonical after transport reconnect.
  assert.equal(
    r.applyCommittedDelta({ workspaceId: "wsA", seq: 1, data: [{ key, value: { v: 1 } }] }),
    "gap",
  );
});

test("broad transport reconnect (empty keys) still arms gap schedule", () => {
  const client = new QueryClient();
  const r = new RealtimeReconciler({ workspaceId: "wsA", client, now: () => 50 });
  const entry = r.notifyTransportReconnect();
  assert.equal(entry.cause, "gap");
  assert.equal(entry.keys.length, 0);
  assert.equal(entry.delayMs, 0);
});

test("parseCursorProjection allowlists cursor fields and rejects regression-shaped garbage", () => {
  const dto = parseCursorProjection(fixtureCursorProjection({ output_cursor: 42 }));
  assert.ok(dto);
  assert.equal(dto.output_cursor, 42);
  assert.equal(parseCursorProjection({ ...fixtureCursorProjection(), output_cursor: -1 }), null);
  // Extra secret fields on a valid shape are dropped by rebuild.
  const withExtra = {
    ...fixtureCursorProjection({ output_cursor: 3 }),
    capability_hash: "abc123",
    token: "sk-secret-value",
  };
  const parsed = parseCursorProjection(withExtra);
  assert.ok(parsed);
  assert.ok(!JSON.stringify(parsed).includes("sk-secret"));
  assert.ok(!JSON.stringify(parsed).includes("abc123"));
});

test("advanceCursor refuses regression and accepts monotonic progress", () => {
  assert.equal(advanceCursor(10, 10), 10);
  assert.equal(advanceCursor(10, 11), 11);
  assert.equal(advanceCursor(10, 9), null);
  assert.equal(advanceCursor(-1, 1), null);
});

test("parseCapabilityError classifies adapter/reconcile reasons and drops hashes", () => {
  assert.equal(classifyCapabilityReason("contract version mismatch: required 1 offered 2"), "contract_version_mismatch");
  assert.equal(classifyCapabilityReason("missing required features: slots.read"), "missing_required_features");
  assert.equal(classifyCapabilityReason("capability revoked"), "capability_revoked");
  assert.equal(classifyCapabilityReason("duplicate active dispatch for task"), "duplicate_dispatch");
  assert.equal(classifyCapabilityReason("cursor regression refused: have 10 got 5"), "cursor_regression");

  const err = parseCapabilityError({
    reason: "capability revoked",
    attempt_dispatch_id: "ctx_attempt_1",
    capability_hash: "deadbeef",
    token: "sk-secret-value",
  });
  assert.ok(err);
  assert.equal(err.code, "capability_revoked");
  assert.equal(err.attempt_dispatch_id, "ctx_attempt_1");
  assert.ok(!JSON.stringify(err).includes("deadbeef"));
  assert.ok(!JSON.stringify(err).includes("sk-secret"));
});

test("toSlotView surfaces capability errors ahead of reconnect drift", () => {
  const slots = parseRuntimeSlots(fixtureRuntimeSlots({ state: "running" }));
  const view = toSlotView(slots!, "orca-lab-0", fixtureReconcileProjection({ phase: "reconnecting" }), {
    cursor: fixtureCursorProjection({ output_cursor: 7 }),
    capabilityError: fixtureCapabilityError({
      code: "duplicate_dispatch",
      message: "duplicate dispatch refused",
      active_dispatch_id: "ctx_active_1",
      attempt_dispatch_id: "ctx_attempt_2",
    }),
  });
  assert.equal(view.status, "error");
  assert.equal(view.statusText, "Duplicate dispatch");
  assert.equal(view.cursor?.output_cursor, 7);
  assert.equal(view.capabilityError?.active_dispatch_id, "ctx_active_1");
});

test("adoptCursor refuses regression and clears awaiting-canonical on legal adopt", () => {
  const client = new QueryClient();
  const r = new RealtimeReconciler({ workspaceId: "wsA", client });
  assert.equal(r.lastCursor(), -1);
  assert.equal(r.adoptCursor(5), true);
  assert.equal(r.lastCursor(), 5);
  assert.equal(r.adoptCursor(4), false, "regression refused");
  assert.equal(r.lastCursor(), 5);
  r.notifyTransportReconnect();
  assert.equal(r.adoptCursor(8), true, "reattach cursor clears gap wait");
  assert.equal(r.lastCursor(), 8);
  assert.equal(
    r.applyCommittedDelta({
      workspaceId: "wsA",
      seq: 9,
      data: [{ key: queryKeys.runtime.snapshot("wsA"), value: { ok: true } }],
    }),
    "applied",
  );
});
