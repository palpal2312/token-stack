import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  S10Registry,
  type S10RegistryPersistence,
  type S10RegistryRecord,
} from "../../src/lib/llmops/s10-registry";
import { evaluateS10Phase4CanaryRecovery } from "../../src/lib/llmops/s10-phase4-canary-recovery";
import { evaluateS10LaneCRecoveryDrill } from "../../src/lib/llmops/s10-lane-c-recovery-drill";

/**
 * A bounded test-only persistence adapter. It writes only a unique OS temp
 * directory owned by this process and is removed in finally. It is not a
 * daemon, outbox, backend, or production storage adapter.
 */
class LocalEvidencePersistence implements S10RegistryPersistence {
  constructor(private readonly filename: string) {}

  read(): readonly S10RegistryRecord[] {
    try {
      return JSON.parse(readFileSync(this.filename, "utf8")) as S10RegistryRecord[];
    } catch {
      return [];
    }
  }

  append(record: S10RegistryRecord): void {
    const records = [...this.read(), structuredClone(record)];
    writeFileSync(this.filename, `${JSON.stringify(records)}\n`, "utf8");
  }
}

test("B3 performs a bounded local registry/canary/recovery operation without publication", () => {
  const directory = mkdtempSync(join(tmpdir(), "s10-b3-local-"));
  const filename = join(directory, "registry.json");
  try {
    const registry = new S10Registry(new LocalEvidencePersistence(filename));
    registry.append({
      recordId: "b3-approval-1",
      kind: "approval",
      idempotencyKey: "b3:approval:1",
      occurredAt: "2026-08-30T13:30:00.000Z",
      payload: { candidateId: "b3-candidate", decision: "approve", approver: "local-independent" },
    });
    const promotion = registry.append({
      recordId: "b3-promotion-1",
      kind: "promotion",
      idempotencyKey: "b3:promotion:1",
      occurredAt: "2026-08-30T13:30:01.000Z",
      payload: { candidateId: "b3-candidate", baselineSha256: "a".repeat(64) },
    });
    const reloaded = new S10Registry(new LocalEvidencePersistence(filename));
    assert.equal(reloaded.snapshot().headSha256, promotion.recordSha256);
    assert.equal(reloaded.list().length, 2);

    const canary = evaluateS10Phase4CanaryRecovery({
      candidateId: "b3-candidate",
      baselineSha256: "a".repeat(64),
      approval: "approve",
      thresholds: { maxObservations: 1, maxErrorRate: 0.01, maxLatencyRatio: 1.1 },
      observations: [{ errorRate: 0.2, latencyRatio: 1 }],
      recovery: [{ scenario: "duplicate-outbox", frozenInputHash: "b3-redacted-input" }],
      slo: { maxCanaryDurationMs: 5, rpoMs: 1, rtoMs: 5 },
    });
    assert.equal(canary.outcome, "rolled-back");
    assert.equal(canary.publication, "none");
    assert.equal(canary.live, false);
    assert.deepEqual(evaluateS10LaneCRecoveryDrill({
      scenario: "stale-lease", frozenInputHash: "b3-redacted-input", leaseFresh: false,
    }), { status: "fail-closed", publication: "none", reason: "lease-stale" });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
