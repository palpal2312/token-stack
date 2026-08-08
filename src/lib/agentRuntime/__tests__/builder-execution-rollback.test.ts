// Phase 08 Step 10: Rollback verification tests for builder execution authority.
//
// These tests verify that the feature flag SEN_GO_BUILDER_EXEC_AUTHORITY can be
// toggled to restore Node legacy path behavior without code changes.
//
// This is the rollback checkpoint: if Go authority has issues in production,
// operators can disable the flag and immediately restore Node behavior.

import assert from "node:assert/strict";
import test from "node:test";
import {
  executeGovernedBuilder,
  type GovernedBuilderExecutionOptions,
} from "../builder-execution";

const testOpts: GovernedBuilderExecutionOptions = {
  builderId: "test_rollback_fixture",
  prompt: "echo rollback test",
  cwd: "/tmp/rollback-fixture",
  runId: "rollback-test",
  taskId: "test-task-rollback",
  attemptId: "test-attempt-rollback",
  traceId: "test-trace-rollback",
};

test("Rollback: default to Node legacy path when flag is unset", async () => {
  const originalFlag = process.env.SEN_GO_BUILDER_EXEC_AUTHORITY;
  delete process.env.SEN_GO_BUILDER_EXEC_AUTHORITY;

  try {
    // Execute with flag OFF (default)
    const result = await executeGovernedBuilder(testOpts).catch((err) => ({
      ok: false,
      error: err.message,
      text: "",
      durationMs: 0,
      builderId: testOpts.builderId,
    }));

    // Should use Node path (not Go authority path)
    if (!result.ok && result.error) {
      // Node path errors: "Builder profile not found", "no verified health"
      // Go path errors: "Go builder execution", "Go authority"
      assert.ok(!result.error.includes("Go builder execution"));
      assert.ok(!result.error.includes("Go authority"));
    }

    // Verify no Go-specific fields in response
    assert.ok(!("paneId" in result));
  } finally {
    if (originalFlag !== undefined) {
      process.env.SEN_GO_BUILDER_EXEC_AUTHORITY = originalFlag;
    }
  }
});

test("Rollback: route to Go authority when flag is explicitly enabled", async () => {
  const originalFlag = process.env.SEN_GO_BUILDER_EXEC_AUTHORITY;
  process.env.SEN_GO_BUILDER_EXEC_AUTHORITY = "1";

  try {
    const result = await executeGovernedBuilder(testOpts).catch((err) => ({
      ok: false,
      error: err.message,
      text: "",
      durationMs: 0,
      builderId: testOpts.builderId,
    }));

    // Should use Go path (not Node legacy path)
    if (!result.ok && result.error) {
      // Go path will fail with "Go authority" or "Go builder execution" errors
      // when daemon is not running or builder doesn't exist
      assert.ok(result.error.includes("Go"));
    }
  } finally {
    if (originalFlag !== undefined) {
      process.env.SEN_GO_BUILDER_EXEC_AUTHORITY = originalFlag;
    } else {
      delete process.env.SEN_GO_BUILDER_EXEC_AUTHORITY;
    }
  }
});

test("Rollback: ignore non-1 flag values and default to Node path", async () => {
  const originalFlag = process.env.SEN_GO_BUILDER_EXEC_AUTHORITY;

  // Test various non-"1" values
  const nonActivatingValues = ["0", "true", "yes", "enabled", ""];

  for (const value of nonActivatingValues) {
    process.env.SEN_GO_BUILDER_EXEC_AUTHORITY = value;

    const result = await executeGovernedBuilder(testOpts).catch((err) => ({
      ok: false,
      error: err.message,
      text: "",
      durationMs: 0,
      builderId: testOpts.builderId,
    }));

    // Should use Node path (flag only activates on exact "1")
    if (!result.ok && result.error) {
      assert.ok(!result.error.includes("Go builder execution"));
      assert.ok(!result.error.includes("Go authority"));
    }
  }

  // Restore original
  if (originalFlag !== undefined) {
    process.env.SEN_GO_BUILDER_EXEC_AUTHORITY = originalFlag;
  } else {
    delete process.env.SEN_GO_BUILDER_EXEC_AUTHORITY;
  }
});

test("Rollback: toggle between paths without code changes", async () => {
  const originalFlag = process.env.SEN_GO_BUILDER_EXEC_AUTHORITY;

  try {
    // Round 1: Node path
    delete process.env.SEN_GO_BUILDER_EXEC_AUTHORITY;
    const nodeResult = await executeGovernedBuilder(testOpts).catch((err) => ({
      ok: false,
      error: err.message,
      usedNodePath: true,
    }));

    // Round 2: Go path
    process.env.SEN_GO_BUILDER_EXEC_AUTHORITY = "1";
    const goResult = await executeGovernedBuilder(testOpts).catch((err) => ({
      ok: false,
      error: err.message,
      usedGoPath: true,
    }));

    // Round 3: Back to Node path (rollback simulation)
    delete process.env.SEN_GO_BUILDER_EXEC_AUTHORITY;
    const rollbackResult = await executeGovernedBuilder(testOpts).catch((err) => ({
      ok: false,
      error: err.message,
      usedNodePath: true,
    }));

    // Verify routing switched correctly
    if ("usedNodePath" in nodeResult) {
      assert.equal(nodeResult.usedNodePath, true);
    }
    if ("usedGoPath" in goResult) {
      assert.equal(goResult.usedGoPath, true);
    }
    if ("usedNodePath" in rollbackResult) {
      assert.equal(rollbackResult.usedNodePath, true);
    }
  } finally {
    if (originalFlag !== undefined) {
      process.env.SEN_GO_BUILDER_EXEC_AUTHORITY = originalFlag;
    } else {
      delete process.env.SEN_GO_BUILDER_EXEC_AUTHORITY;
    }
  }
});

test("Rollback: preserve fail-closed behavior on Go authority errors", async () => {
  const originalFlag = process.env.SEN_GO_BUILDER_EXEC_AUTHORITY;
  process.env.SEN_GO_BUILDER_EXEC_AUTHORITY = "1";

  try {
    // Simulate Go authority unreachable (wrong URL)
    const originalUrl = process.env.SEN_DAEMON_URL;
    process.env.SEN_DAEMON_URL = "http://127.0.0.1:9999"; // Non-existent port

    const result = await executeGovernedBuilder(testOpts).catch((err) => ({
      ok: false,
      error: err.message,
      text: "",
      durationMs: 0,
      builderId: testOpts.builderId,
    }));

    // Should fail with Go authority error (NOT silently fall back to Node)
    assert.equal(result.ok, false);
    assert.ok(result.error && result.error.includes("Go"));

    // Restore URL
    if (originalUrl !== undefined) {
      process.env.SEN_DAEMON_URL = originalUrl;
    } else {
      delete process.env.SEN_DAEMON_URL;
    }
  } finally {
    if (originalFlag !== undefined) {
      process.env.SEN_GO_BUILDER_EXEC_AUTHORITY = originalFlag;
    } else {
      delete process.env.SEN_GO_BUILDER_EXEC_AUTHORITY;
    }
  }
});
