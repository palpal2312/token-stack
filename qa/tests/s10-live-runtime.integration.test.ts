import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import test from "node:test";

const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function daemonArgs(root: string, reuse = false, cleanup = false) { return ["node_modules/tsx/dist/cli.mjs", "tools/s10-live-runtime/daemon.ts", "--runtime-root", root, ...(reuse ? ["--reuse-owned-root"] : []), ...(cleanup ? ["--cleanup"] : [])]; }
function invokeDaemon(root: string, token: string, reuse = false, cleanup = false) { return new Promise<{ code: number | null; errors: string }>((resolve) => { let errors = ""; const child = spawn(process.execPath, daemonArgs(root, reuse, cleanup), { cwd: process.cwd(), env: { ...process.env, S10_RUNTIME_OWNERSHIP_TOKEN: token }, stdio: ["ignore", "ignore", "pipe"] }); child.stderr.on("data", (data) => { errors += data; }); child.once("close", (code) => resolve({ code, errors })); }); }
function startDaemon(root: string, token: string, children: Set<ChildProcess>, port = "0", reuse = false) {
  const child = spawn(process.execPath, [...daemonArgs(root, reuse), "--port", port], { cwd: process.cwd(), env: { ...process.env, S10_RUNTIME_OWNERSHIP_TOKEN: token }, stdio: ["ignore", "pipe", "pipe"] });
  children.add(child); let output = ""; let errors = "";
  child.stdout.on("data", (data) => { output += data; }); child.stderr.on("data", (data) => { errors += data; });
  const ready = new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => done(() => reject(new Error("daemon startup timeout"))), 20_000);
    const exited = () => done(() => reject(new Error(`daemon exited before ready: ${errors || "no diagnostic"}`)));
    const done = (fn: () => void) => { clearTimeout(timer); child.off("exit", exited); fn(); };
    const tick = () => { const match = output.match(/"port":(\d+)/); if (match) done(() => resolve(Number(match[1]))); else if (child.exitCode === null && child.signalCode === null) setTimeout(tick, 20); };
    child.once("exit", exited); tick();
  });
  return { child, ready };
}
async function stop(child: ChildProcess) { if (child.exitCode !== null || child.signalCode !== null) return; const exited = new Promise<void>((resolve) => child.once("exit", () => resolve())); child.kill("SIGTERM"); await Promise.race([exited, pause(2_500)]); if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; } }
test("S10 loopback daemon executes controlled live-runtime drills", async () => {
  const root = join(tmpdir(), `s10-live-runtime-${randomBytes(12).toString("hex")}`); const token = randomBytes(32).toString("base64url"); const sentinel = join(tmpdir(), `s10-sentinel-${Date.now()}`); const children = new Set<ChildProcess>(); writeFileSync(sentinel, "preserve", "utf8");
  try {
    const first = startDaemon(root, token, children); const port = await first.ready;
    const request = async (path: string, payload?: unknown) => { const began = performance.now(); const res = await fetch(`http://127.0.0.1:${port}${path}`, payload ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) } : undefined); return { status: res.status, body: await res.json() as Record<string, unknown>, ms: performance.now() - began }; };
    assert.equal((await request("/health")).status, 200);
    assert.equal((await request("/action/approval", { candidate: "candidate-a", decision: "reject" })).body.noOp, true);
    assert.equal((await request("/action/canary", { candidate: "candidate-a", observations: [{ errorRate: 0 }] })).status, 409);
    await request("/action/approval", { candidate: "candidate-a", decision: "approve" }); const canary = await request("/action/canary", { candidate: "candidate-a", observations: [{ errorRate: 0 }] }); assert.equal(canary.body.outcome, "canary-passed-advisory"); const invalidCanary = await request("/action/canary", { candidate: "candidate-a", observations: [{ errorRate: "invalid" }] }); assert.equal(invalidCanary.body.outcome, "rolled-back-invalid-observation"); assert.equal(invalidCanary.body.failClosed, true); const thresholdCanary = await request("/action/canary", { candidate: "candidate-a", observations: [{ errorRate: .06 }] }); assert.equal(thresholdCanary.body.outcome, "rolled-back"); assert.equal(thresholdCanary.body.failClosed, true);
    assert.equal((await request("/action/outbox", { id: "event-a" })).body.delivered, 1); assert.equal((await request("/action/outbox", { id: "event-a" })).body.suppressedDuplicate, true);
    const held = await request("/action/lease", { owner: "owner-a", ttlMs: 100 }); assert.equal(held.status, 200); const heldToken = Number(held.body.fencingToken); assert.equal((await request("/action/mutate", { owner: "owner-a", fencingToken: heldToken, mutation: "valid" })).status, 200); assert.equal((await request("/action/lease", { owner: "owner-b", ttlMs: 100 })).status, 409); await pause(120); const reacquired = await request("/action/lease", { owner: "owner-b", ttlMs: 500 }); assert.equal(reacquired.status, 200); assert.ok(Number(reacquired.body.fencingToken) > heldToken); const mutationsBeforeStale = (await request("/status")).body.durableMutations; const stale = await request("/action/mutate", { owner: "owner-a", fencingToken: heldToken, mutation: "stale" }); assert.equal(stale.status, 409); assert.equal((await request("/status")).body.durableMutations, mutationsBeforeStale);
    await pause(510); const snapshot = await request("/action/snapshot", { name: "before-rollback" }); const snapshotLease = await request("/action/lease", { owner: "owner-c", ttlMs: 50 }); const snapshotToken = Number(snapshotLease.body.fencingToken); await pause(60); const advancedLease = await request("/action/lease", { owner: "owner-c", ttlMs: 500 }); assert.ok(Number(advancedLease.body.fencingToken) > snapshotToken); const mutation = await request("/action/rollback", {}); const restore = await request("/action/restore", { name: "before-rollback" }); assert.equal(restore.status, 200); const restored = await request("/status"); const mutationsBeforeRestoredStale = restored.body.durableMutations; assert.equal((await request("/action/mutate", { owner: "owner-c", fencingToken: snapshotToken, mutation: "restored-stale" })).status, 409); assert.equal((await request("/status")).body.durableMutations, mutationsBeforeRestoredStale); const reacquiredAfterRestore = await request("/action/lease", { owner: "owner-c", ttlMs: 500 }); assert.ok(Number(reacquiredAfterRestore.body.fencingToken) > Number(advancedLease.body.fencingToken)); const rpoMs = Number(mutation.body.persistedAt) - Number(snapshot.body.persistedAt); assert.ok(rpoMs >= 0); assert.ok(Number(restored.body.persistedAt) >= Number(snapshot.body.persistedAt));
    assert.equal((await request("/action/backend", { available: false })).status, 200); assert.equal((await request("/action/rollback", {})).status, 503); await request("/action/backend", { available: true });
    const before = await request("/status"); const restartBeganAt = Date.now(); await stop(first.child); const second = startDaemon(root, token, children, String(port), true); await second.ready; const after = await request("/status"); const rtoMs = Date.now() - restartBeganAt;
    assert.equal(after.body.delivered, before.body.delivered); assert.ok(Number(after.body.persistedAt) >= Number(before.body.persistedAt));
    const receipt = join(root, "s10-live-runtime-receipt.json"); writeFileSync(receipt, `${JSON.stringify({ marker: "JOB_DONE", runtime: "loopback-only", drills: ["restart-recovery", "snapshot-restore", "duplicate-outbox", "stale-lease", "backend-unavailable", "approval-rejection", "canary", "rollback"], sloMs: Math.round(canary.ms), rpoMs, rtoMs, restartBeganAt, snapshotPersistedAt: snapshot.body.persistedAt, restoredPersistedAt: restored.body.persistedAt, finalPersistedAt: after.body.persistedAt, stateSha256: sha256(join(root, "state", "state.json")), secrets: "none" }, null, 2)}\n`); assert.equal(existsSync(receipt), true);
  } finally { await Promise.all([...children].map(stop)); if (existsSync(root)) assert.equal((await invokeDaemon(root, token, true, true)).code, 0); assert.equal(existsSync(sentinel), true); rmSync(sentinel, { force: true }); }
});

test("S10 controller drill runner writes only an explicit temporary report path", async () => {
  const reportDir = mkdtempSync(join(tmpdir(), "s10-live-runtime-reports-")); const output = join(reportDir, "s10-live-runtime-receipt.json");
  try {
    const child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/s10-live-runtime-drill.ts", "--report-dir", reportDir, "--output", output], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] }); let errors = ""; child.stderr.on("data", (data) => { errors += data; }); const code = await new Promise<number | null>((resolve) => child.once("exit", resolve)); assert.equal(code, 0, errors); const receipt = JSON.parse(readFileSync(output, "utf8")) as Record<string, unknown>; assert.equal(receipt.marker, "JOB_DONE"); assert.equal(receipt.cleanupVerified, true); assert.equal(receipt.secrets, "none");
  } finally { rmSync(reportDir, { recursive: true, force: true }); }
});

test("S10 controller drill runner refuses an existing receipt and unapproved report roots", async () => {
  const reportDir = mkdtempSync(join(tmpdir(), "s10-live-runtime-reports-")); const output = join(reportDir, "s10-live-runtime-receipt.json"); writeFileSync(output, "preserve", "utf8");
  const invoke = (dir: string, target: string) => new Promise<number | null>((resolve) => spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/s10-live-runtime-drill.ts", "--report-dir", dir, "--output", target], { cwd: process.cwd(), stdio: "ignore" }).once("exit", resolve));
  try { assert.notEqual(await invoke(reportDir, output), 0); assert.equal(readFileSync(output, "utf8"), "preserve"); assert.notEqual(await invoke(tmpdir(), join(tmpdir(), "s10-live-runtime-receipt.json")), 0); }
  finally { rmSync(reportDir, { recursive: true, force: true }); }
});

test("S10 cleanup refuses a pre-existing forged runtime root", async () => {
  const root = mkdtempSync(join(tmpdir(), "s10-live-runtime-")); const preserved = join(root, "preserve.txt"); const token = randomBytes(32).toString("base64url");
  writeFileSync(join(root, ".s10-live-runtime-owner"), `${randomBytes(32).toString("base64url")}\n`, "utf8"); writeFileSync(preserved, "preserve", "utf8");
  try { const result = await invokeDaemon(root, token, true, true); assert.notEqual(result.code, 0); assert.equal(existsSync(root), true); assert.equal(readFileSync(preserved, "utf8"), "preserve"); }
  finally { rmSync(root, { recursive: true, force: true }); }
});
