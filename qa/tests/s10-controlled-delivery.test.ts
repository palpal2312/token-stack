import assert from "node:assert/strict";
import test from "node:test";

import {
  decideS10Candidate,
  monitorS10Canary,
  proposeS10Candidate,
  rollbackS10Candidate,
  startS10Canary,
  supersedeS10Candidate,
} from "../../src/lib/llmops/s10-controlled-delivery";

const BASELINE = "a".repeat(64);

test("S10 candidate requires explicit approval before its bounded canary", () => {
  const proposed = proposeS10Candidate("candidate-a", BASELINE);
  assert.deepEqual(proposed, {
    candidate: { candidateId: "candidate-a", baselineSha256: BASELINE, status: "awaiting-approval", approval: "pending", canary: null, supersededBy: null },
    advisory: true,
    effect: "none",
  });
  assert.throws(() => startS10Canary(proposed, 2), /explicit approval/);
  const approved = decideS10Candidate(proposed, "approve");
  const running = startS10Canary(approved, 2);
  assert.equal(running.candidate.status, "canary-running");
  assert.deepEqual(running.candidate.canary, { maxObservations: 2, observed: 0, alert: false });
});

test("S10 rejection is a valid no-op and does not start a canary", () => {
  const rejected = decideS10Candidate(proposeS10Candidate("candidate-b", BASELINE), "reject");
  assert.equal(rejected.candidate.status, "rejected");
  assert.equal(rejected.candidate.approval, "rejected");
  assert.equal(rejected.candidate.canary, null);
  assert.equal(rejected.effect, "none");
  assert.throws(() => startS10Canary(rejected, 1), /explicit approval/);
});

test("S10 canary is monitored, bounded, and alert rollback is reversible to its pinned baseline", () => {
  const approved = decideS10Candidate(proposeS10Candidate("candidate-c", BASELINE), "approve");
  const running = startS10Canary(approved, 2);
  const observed = monitorS10Canary(running, { alert: false });
  assert.equal(observed.candidate.status, "canary-running");
  const rolledBack = monitorS10Canary(observed, { alert: true });
  assert.equal(rolledBack.candidate.status, "rolled-back");
  assert.equal(rolledBack.candidate.baselineSha256, BASELINE);
  assert.equal(rolledBack.candidate.canary?.alert, true);
  assert.throws(() => monitorS10Canary(rolledBack, { alert: false }), /no running canary/);
});

test("S10 supersession discards inherited approval and starts the replacement pending", () => {
  const approved = decideS10Candidate(proposeS10Candidate("candidate-d", BASELINE), "approve");
  const { superseded, replacement } = supersedeS10Candidate(approved, "candidate-e", "b".repeat(64));
  assert.equal(superseded.candidate.status, "superseded");
  assert.equal(superseded.candidate.supersededBy, "candidate-e");
  assert.equal(replacement.candidate.status, "awaiting-approval");
  assert.equal(replacement.candidate.approval, "pending");
  assert.equal(replacement.effect, "none");
  assert.equal(rollbackS10Candidate(approved).candidate.status, "rolled-back");
});
