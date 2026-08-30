import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const receipt = join(process.cwd(), "plans", "reports", "sprint10", "s10-live-runtime-receipt.json");
const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
function startDaemon(root: string, port = "0") {
  const child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "tools/s10-live-runtime/daemon.ts", "--runtime-root", root, "--port", port], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
  let output = ""; child.stdout.on("data", (data) => { output += data; });
  const ready = new Promise<number>((resolve, reject) => { const timer = setTimeout(() => reject(new Error("daemon startup timeout")), 5_000); const tick = () => { const match = output.match(/"port":(\d+)/); if (match) { clearTimeout(timer); resolve(Number(match[1])); } else setTimeout(tick, 20); }; tick(); });
  return { child, ready };
}
test("S10 loopback daemon executes controlled live-runtime drills", async () => {
  const root = mkdtempSync(join(tmpdir(), "s10-live-runtime-")); const sentinel = join(tmpdir(), `s10-sentinel-${Date.now()}`); writeFileSync(sentinel, "preserve", "utf8");
  const startedDaemon = startDaemon(root); const child = startedDaemon.child;
  try {
    const started = await startedDaemon.ready;
    const request = async (path: string, payload?: unknown) => { const began = performance.now(); const res = await fetch(`http://127.0.0.1:${started}${path}`, payload ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) } : undefined); return { status: res.status, body: await res.json() as Record<string, unknown>, ms: performance.now() - began }; };
    assert.equal((await request("/health")).status, 200);
    assert.equal((await request("/action/approval", { candidate: "candidate-a", decision: "reject" })).body.noOp, true);
    assert.equal((await request("/action/canary", { candidate: "candidate-a", observations: [{ errorRate: 0 }] })).status, 409);
    await request("/action/approval", { candidate: "candidate-a", decision: "approve" });
    const canary = await request("/action/canary", { candidate: "candidate-a", observations: [{ errorRate: 0 }] }); assert.equal(canary.body.outcome, "canary-passed-advisory");
    assert.equal((await request("/action/outbox", { id: "event-a" })).body.delivered, 1); assert.equal((await request("/action/outbox", { id: "event-a" })).body.suppressedDuplicate, true);
    assert.equal((await request("/action/lease", { stale: true })).status, 409);
    await request("/action/snapshot", { name: "before-rollback" }); await request("/action/rollback", {}); const restore = await request("/action/restore", { name: "before-rollback" }); assert.equal(restore.status, 200);
    assert.equal((await request("/action/backend", { available: false })).status, 200); assert.equal((await request("/action/rollback", {})).status, 503); await request("/action/backend", { available: true });
    const before = await request("/status"); child.kill("SIGTERM"); await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    const restartBegan = performance.now(); const restartedDaemon = startDaemon(root, String(started)); await restartedDaemon.ready; const after = await request("/status"); const rtoMs = Math.round(performance.now() - restartBegan); restartedDaemon.child.kill("SIGTERM"); await new Promise<void>((resolve) => restartedDaemon.child.once("exit", () => resolve()));
    assert.equal(after.body.delivered, before.body.delivered);
    writeFileSync(receipt, `${JSON.stringify({ marker: "JOB_DONE", runtime: "loopback-only", drills: ["restart-recovery", "snapshot-restore", "duplicate-outbox", "stale-lease", "backend-unavailable", "approval-rejection", "canary", "rollback"], sloMs: Math.round(canary.ms), rpoMs: 0, rtoMs, stateSha256: sha256(join(root, "state", "state.json")), secrets: "none" }, null, 2)}\n`);
  } finally { if (!child.killed) child.kill("SIGTERM"); rmSync(root, { recursive: true, force: true }); assert.equal(existsSync(sentinel), true); rmSync(sentinel, { force: true }); }
});
