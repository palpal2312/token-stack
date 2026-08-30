import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { evaluateS10LaneCRecoveryDrill, type S10LaneCDrillInput } from "../../src/lib/llmops/s10-lane-c-recovery-drill";

const frozenInputHash = "redacted-fixture-sha256";
const evaluate = (input: Omit<S10LaneCDrillInput, "frozenInputHash">) =>
  evaluateS10LaneCRecoveryDrill({ frozenInputHash, ...input });

test("Lane C models daemon crash and restore as hash-pinned replay only", () => {
  for (const scenario of ["daemon-crash", "restore"] as const) {
    assert.deepEqual(evaluate({ scenario }), {
      status: "replay-required",
      publication: "replay-only",
      reason: scenario === "daemon-crash" ? "daemon-crash-replay-from-frozen-input" : "restore-replay-from-frozen-input",
    });
  }
});

test("Lane C suppresses duplicate outbox publication and fails closed on stale leases", () => {
  assert.deepEqual(evaluate({ scenario: "duplicate-outbox" }), {
    status: "duplicate-suppressed", publication: "none", reason: "publication-already-recorded",
  });
  assert.deepEqual(evaluate({ scenario: "stale-lease", leaseFresh: false }), {
    status: "fail-closed", publication: "none", reason: "lease-stale",
  });
});

test("Lane C makes unavailable backends and invalid snapshots non-executable", () => {
  assert.deepEqual(evaluate({ scenario: "backend-unavailable" }), {
    status: "not-measurable", publication: "none", reason: "backend-unavailable",
  });
  assert.deepEqual(evaluate({ scenario: "invalid-snapshot", snapshotValid: false }), {
    status: "fail-closed", publication: "none", reason: "snapshot-invalid",
  });
  assert.deepEqual(evaluateS10LaneCRecoveryDrill({ scenario: "restore" }), {
    status: "not-measurable", publication: "none", reason: "frozen-input-hash-unavailable",
  });
});

test("Lane C drill remains a pure local model with no command, network, or write APIs", () => {
  const source = readFileSync(resolve(process.cwd(), "src/lib/llmops/s10-lane-c-recovery-drill.ts"), "utf8");
  const forbidden = ["child_" + "process", "h" + "ttp", "h" + "ttps", "n" + "et", "t" + "ls", "d" + "gram", "fe" + "tch", "sp" + "awn", "ex" + "ec", "write" + "File", "append" + "File"];
  assert.equal(new RegExp(`node:(?:${forbidden.slice(0, 6).join("|")})|\\b(?:${forbidden.slice(6).join("|")})\\b`, "i").test(source), false);
});
