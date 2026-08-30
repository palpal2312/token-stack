import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { evaluateS10Phase4CanaryRecovery, simulateS10Phase4Supersession } from "../../src/lib/llmops/s10-phase4-canary-recovery";

const fixture = JSON.parse(readFileSync(resolve(process.cwd(), "qa/fixtures/sprint10/s10-phase4-simulated-canary-v1.json"), "utf8"));
const common = { candidateId: fixture.candidate_id, baselineSha256: fixture.baseline_sha256, thresholds: fixture.thresholds, recovery: fixture.recovery, slo: fixture.slo };

test("Phase 4 passes only an explicitly approved, bounded simulated canary", () => {
  const result = evaluateS10Phase4CanaryRecovery({ ...common, approval: "approve", observations: fixture.passing_observations });
  assert.equal(result.mode, "simulated-redacted");
  assert.equal(result.live, false);
  assert.equal(result.outcome, "canary-passed-advisory");
  assert.equal(result.delivery.candidate.status, "canary-passed");
  assert.equal(result.delivery.candidate.canary?.observed, 2);
  assert.equal(result.publication, "none");
  assert.equal(result.slo.status, "within-bounds");
});

test("Phase 4 records valid rejection/no-op and threshold rollback without a promotion", () => {
  const rejected = evaluateS10Phase4CanaryRecovery({ ...common, approval: "reject", observations: [] });
  assert.equal(rejected.outcome, "rejected-no-op");
  assert.equal(rejected.delivery.candidate.canary, null);
  const rolledBack = evaluateS10Phase4CanaryRecovery({ ...common, approval: "approve", observations: fixture.alert_observations });
  assert.equal(rolledBack.outcome, "rolled-back");
  assert.equal(rolledBack.delivery.candidate.status, "rolled-back");
  assert.equal(rolledBack.delivery.candidate.baselineSha256, fixture.baseline_sha256);
});

test("Phase 4 recovery simulations remain bounded and fail closed as appropriate", () => {
  const result = evaluateS10Phase4CanaryRecovery({ ...common, approval: "reject", observations: [] });
  assert.deepEqual(result.recovery.map((item) => item.status), ["replay-required", "replay-required", "duplicate-suppressed", "fail-closed", "not-measurable", "fail-closed"]);
  assert.deepEqual(result.recovery.map((item) => item.publication), ["replay-only", "replay-only", "none", "none", "none", "none"]);
  const { replacement } = simulateS10Phase4Supersession(common, "candidate-redacted-v2", "b".repeat(64));
  assert.equal(replacement.candidate.approval, "pending");
});

test("Phase 4 module is a pure simulation with no live execution surface", () => {
  const source = readFileSync(resolve(process.cwd(), "src/lib/llmops/s10-phase4-canary-recovery.ts"), "utf8");
  const forbidden = ["child_" + "process", "h" + "ttp", "h" + "ttps", "n" + "et", "t" + "ls", "d" + "gram", "fe" + "tch", "sp" + "awn", "ex" + "ec", "write" + "File", "append" + "File"];
  assert.equal(new RegExp(`node:(?:${forbidden.slice(0, 6).join("|")})|\\b(?:${forbidden.slice(6).join("|")})\\b`, "i").test(source), false);
});
