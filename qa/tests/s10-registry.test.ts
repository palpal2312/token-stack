import assert from "node:assert/strict";
import test from "node:test";

import { S10MemoryPersistence, S10Registry, S10RegistryConflict } from "../../src/lib/llmops/s10-registry";

const at = "2026-08-30T10:00:00.000Z";

test("S10 registry redacts local fields, chains records, and retries idempotently", () => {
  const registry = new S10Registry();
  const signal = registry.append({ recordId: "signal-1", kind: "signal", idempotencyKey: "signal:1", occurredAt: at, payload: { summary: "private", score: 0.9 } });
  const retry = registry.append({ recordId: "signal-1-retry", kind: "signal", idempotencyKey: "signal:1", occurredAt: at, payload: { summary: "private", score: 0.9 } });
  assert.equal(retry.recordSha256, signal.recordSha256);
  assert.equal(signal.payload.summary, "[LOCAL-SENSITIVE]");
  assert.equal(registry.snapshot().records.length, 1);
  assert.equal(registry.snapshot().headSha256, signal.recordSha256);
});

test("S10 registry rejects idempotency conflicts and promotion without approval", () => {
  const registry = new S10Registry();
  registry.append({ recordId: "evidence-1", kind: "evidence", idempotencyKey: "evidence:1", occurredAt: at, payload: { value: 1 } });
  assert.throws(() => registry.append({ recordId: "evidence-2", kind: "evidence", idempotencyKey: "evidence:1", occurredAt: at, payload: { value: 2 } }), S10RegistryConflict);
  assert.throws(() => registry.append({ recordId: "promotion-1", kind: "promotion", idempotencyKey: "promotion:1", occurredAt: at, payload: { candidateId: "candidate-a" } }), /explicit approval/);
});

test("approval is explicit, promotion is append-only, and persistence reload verifies the chain", () => {
  const persistence = new S10MemoryPersistence();
  const first = new S10Registry(persistence);
  first.append({ recordId: "approval-1", kind: "approval", idempotencyKey: "approval:1", occurredAt: at, payload: { candidateId: "candidate-a", decision: "approve", approver: "arbiter-a" } });
  const promotion = first.append({ recordId: "promotion-1", kind: "promotion", idempotencyKey: "promotion:1", occurredAt: at, payload: { candidateId: "candidate-a", baselineSha256: "a".repeat(64) } });
  const reloaded = new S10Registry(persistence);
  assert.equal(reloaded.snapshot().headSha256, promotion.recordSha256);
  assert.equal(reloaded.list().length, 2);
});
