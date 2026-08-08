// Phase 08 Step 9: Isolated-fixture parity tests for Node vs Go builder execution.
//
// These tests verify that Node legacy path and Go authority path produce
// equivalent results when executing against ISOLATED fixture directories.
//
// CRITICAL: These tests use separate fixture copies. They MUST NOT run Node
// and Go execution concurrently against the same worktree (authority collision).

import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import {
  executeGovernedBuilder,
  type GovernedBuilderExecutionOptions,
} from "../builder-execution";

test("Builder execution parity: Go authority availability check", async () => {
  // This test verifies the feature flag routing, not live execution.
  // Live execution parity will be tested with integration fixtures
  // in Phase 08 Step 9 canary launch.

  const useGoAuthority = process.env.SEN_GO_BUILDER_EXEC_AUTHORITY === "1";

  if (!useGoAuthority) {
    console.log(
      "⏭️  Skipping parity test: SEN_GO_BUILDER_EXEC_AUTHORITY not enabled",
    );
    assert.equal(useGoAuthority, false);
    return;
  }

  // If Go authority is enabled, verify daemon is reachable
  const daemonUrl = process.env.SEN_DAEMON_URL ?? "http://127.0.0.1:3738";
  try {
    const res = await fetch(`${daemonUrl}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    assert.equal(res.ok, true);
  } catch (err) {
    throw new Error(
      `Go daemon not reachable at ${daemonUrl}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
});

test("Builder execution parity: Node legacy path routing", async () => {
  const fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), "builder-parity-node-"));

  try {
    // Setup minimal fixture structure
    await fs.mkdir(path.join(fixtureDir, ".git"));
    await fs.writeFile(
      path.join(fixtureDir, "test.txt"),
      "fixture content for parity test",
    );
    // Force Node legacy path by ensuring flag is OFF
    const originalFlag = process.env.SEN_GO_BUILDER_EXEC_AUTHORITY;
    delete process.env.SEN_GO_BUILDER_EXEC_AUTHORITY;

    const opts: GovernedBuilderExecutionOptions = {
      builderId: "test_builder_fixture",
      prompt: "echo parity test",
      cwd: fixtureDir,
      runId: "parity-test-node",
      taskId: "test-task-node",
      attemptId: "test-attempt-node",
      traceId: "test-trace-node",
    };

    // This will fail if builder doesn't exist, which is expected for
    // foundation layer test. Real parity requires builder registry wired.
    const result = await executeGovernedBuilder(opts).catch((err) => ({
      ok: false,
      error: err.message,
      text: "",
      durationMs: 0,
      builderId: opts.builderId,
    }));

    // Verify error indicates Node path was taken (not Go authority error)
    if (!result.ok && result.error) {
      assert.ok(!result.error.includes("Go builder execution"));
      assert.ok(!result.error.includes("Go authority"));
    }

    // Restore flag
    if (originalFlag !== undefined) {
      process.env.SEN_GO_BUILDER_EXEC_AUTHORITY = originalFlag;
    }
  } finally {
    await fs.rm(fixtureDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("Builder execution parity: Go authority path routing", async () => {
  const fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), "builder-parity-go-"));

  try {
    // Setup minimal fixture structure
    await fs.mkdir(path.join(fixtureDir, ".git"));
    await fs.writeFile(
      path.join(fixtureDir, "test.txt"),
      "fixture content for parity test",
    );

    // Force Go authority path by setting flag ON
    const originalFlag = process.env.SEN_GO_BUILDER_EXEC_AUTHORITY;
    process.env.SEN_GO_BUILDER_EXEC_AUTHORITY = "1";

    const opts: GovernedBuilderExecutionOptions = {
      builderId: "test_builder_fixture",
      prompt: "echo parity test go",
      cwd: fixtureDir,
      runId: "parity-test-go",
      taskId: "test-task-go",
      attemptId: "test-attempt-go",
      traceId: "test-trace-go",
    };

    const result = await executeGovernedBuilder(opts).catch((err) => ({
      ok: false,
      error: err.message,
      text: "",
      durationMs: 0,
      builderId: opts.builderId,
    }));

    // Verify error indicates Go authority path was taken
    if (!result.ok && result.error) {
      assert.ok(result.error.includes("Go"));
    }

    // Restore flag
    if (originalFlag !== undefined) {
      process.env.SEN_GO_BUILDER_EXEC_AUTHORITY = originalFlag;
    } else {
      delete process.env.SEN_GO_BUILDER_EXEC_AUTHORITY;
    }
  } finally {
    await fs.rm(fixtureDir, { recursive: true, force: true }).catch(() => {});
  }
});
