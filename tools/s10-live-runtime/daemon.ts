/** Disposable S10 drill daemon. It creates and cleans up only a token-owned temp root. */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

type Lease = { owner: string; expiresAt: number; fencingToken: number };
type State = { generation: number; backendAvailable: boolean; activeCandidate: string | null; approvals: string[]; outbox: string[]; delivered: string[]; lease: Lease | null; rolledBack: boolean; snapshots: Record<string, State>; persistedAt: number };
const now = () => Date.now(); const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T; const markerName = ".s10-live-runtime-owner";
const rootArg = process.argv.indexOf("--runtime-root"); const portArg = process.argv.indexOf("--port");
if (rootArg < 0 || !process.argv[rootArg + 1]) throw new Error("--runtime-root must be explicitly supplied.");
const root = resolve(process.argv[rootArg + 1]); const tempRoot = resolve(tmpdir());
const runtimeToken = process.env.S10_RUNTIME_OWNERSHIP_TOKEN;
if (!runtimeToken || !/^[A-Za-z0-9_-]{43}$/.test(runtimeToken)) throw new Error("S10_RUNTIME_OWNERSHIP_TOKEN must be an unguessable 32-byte base64url token.");
const reuseOwnedRoot = process.argv.includes("--reuse-owned-root"); const cleanupOnly = process.argv.includes("--cleanup");
function assertRuntimeRoot(runtimeRoot: string, token: string, allowReuse = false) {
  const target = resolve(runtimeRoot);
  if (dirname(target) !== tempRoot || !/^s10-live-runtime-[A-Za-z0-9_-]+$/.test(basename(target))) throw new Error("runtime root must be an immediate s10-live-runtime-* child of the OS temp directory.");
  if (!existsSync(target)) {
    if (allowReuse) throw new Error("owned runtime root is missing.");
    mkdirSync(target); // Exclusive creation is the ownership boundary; never adopt an existing directory.
    writeFileSync(join(target, markerName), `${token}\n`, { encoding: "utf8", flag: "wx" });
    return target;
  }
  if (lstatSync(target).isSymbolicLink() || !statSync(target).isDirectory()) throw new Error("runtime root must be a non-link directory.");
  if (!allowReuse) throw new Error("runtime root already exists; refusing to adopt a pre-existing directory.");
  const marker = join(target, markerName);
  if (!existsSync(marker) || readFileSync(marker, "utf8") !== `${token}\n`) throw new Error("runtime root ownership token is invalid.");
  return target;
}
assertRuntimeRoot(root, runtimeToken, reuseOwnedRoot);
const port = portArg >= 0 ? Number(process.argv[portArg + 1]) : 0;
if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error("port must be valid.");
const stateFile = join(root, "state", "state.json");
for (const dir of [join(root, "state"), join(root, "outbox"), join(root, "lease"), join(root, "snapshots")]) mkdirSync(dir, { recursive: true });
function initialState(): State { return { generation: 0, backendAvailable: true, activeCandidate: null, approvals: [], outbox: [], delivered: [], lease: null, rolledBack: false, snapshots: {}, persistedAt: now() }; }
function isState(value: unknown): value is State { if (typeof value !== "object" || value === null) return false; const s = value as Record<string, unknown>; return Number.isSafeInteger(s.generation) && typeof s.backendAvailable === "boolean" && (typeof s.activeCandidate === "string" || s.activeCandidate === null) && Array.isArray(s.approvals) && Array.isArray(s.outbox) && Array.isArray(s.delivered) && (s.lease === null || (typeof s.lease === "object" && s.lease !== null && typeof (s.lease as Lease).owner === "string" && Number.isFinite((s.lease as Lease).expiresAt) && Number.isSafeInteger((s.lease as Lease).fencingToken))) && typeof s.rolledBack === "boolean" && typeof s.snapshots === "object" && s.snapshots !== null && Number.isFinite(s.persistedAt); }
function load(): State { if (!existsSync(stateFile)) return initialState(); let parsed: unknown; try { parsed = JSON.parse(readFileSync(stateFile, "utf8")); } catch { throw new Error("state is unreadable; refusing to initialize over durable state."); } if (!isState(parsed)) throw new Error("state is malformed; refusing to initialize over durable state."); return parsed; }
function save(next: State) { next.persistedAt = now(); const temp = `${stateFile}.tmp`; writeFileSync(temp, JSON.stringify(next), "utf8"); renameSync(temp, stateFile); }
let state = load(); state.generation++; save(state);
function response(res: ServerResponse, code: number, body: unknown) { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); }
async function body(req: IncomingMessage): Promise<Record<string, unknown>> { let raw = ""; for await (const part of req) raw += part; if (raw.length > 16_384) throw new Error("payload too large"); return raw ? JSON.parse(raw) as Record<string, unknown> : {}; }
function requireText(value: unknown, name: string) { if (typeof value !== "string" || !/^[a-z0-9-]{1,64}$/.test(value)) throw new Error(`${name} invalid`); return value; }
function requireTtl(value: unknown): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 10 || value > 60_000) throw new Error("ttlMs invalid"); return value; }
const server = createServer(async (req, res) => { try {
  if (req.method === "GET" && req.url === "/health") return response(res, 200, { ok: true, generation: state.generation, persistedAt: state.persistedAt, loopbackOnly: true, legacyWriter: "disabled", phase21: "blocked" });
  if (req.method === "GET" && req.url === "/status") return response(res, 200, { generation: state.generation, persistedAt: state.persistedAt, backendAvailable: state.backendAvailable, activeCandidate: state.activeCandidate, delivered: state.delivered.length, lease: state.lease, rolledBack: state.rolledBack });
  if (req.method !== "POST" || !req.url?.startsWith("/action/")) return response(res, 404, { error: "not found" });
  const input = await body(req); const action = req.url.slice("/action/".length);
  if (action === "backend") { state.backendAvailable = input.available === true; save(state); return response(res, 200, { backendAvailable: state.backendAvailable, persistedAt: state.persistedAt }); }
  if (!state.backendAvailable) return response(res, 503, { error: "backend-unavailable", failClosed: true });
  if (action === "approval") { const candidate = requireText(input.candidate, "candidate"); if (input.decision !== "approve" && input.decision !== "reject") throw new Error("decision invalid"); if (input.decision === "approve") state.approvals.push(candidate); else state.activeCandidate = null; save(state); return response(res, 200, { decision: input.decision, noOp: input.decision === "reject" }); }
  if (action === "canary") { const candidate = requireText(input.candidate, "candidate"); const observations = input.observations; if (!state.approvals.includes(candidate)) return response(res, 409, { error: "approval-required", failClosed: true }); if (!Array.isArray(observations) || observations.length < 1 || observations.length > 5) throw new Error("observations must be bounded"); const breached = observations.some((x) => typeof x !== "object" || x === null || Number((x as Record<string, unknown>).errorRate) > .05); state.activeCandidate = breached ? null : candidate; state.rolledBack = breached; save(state); return response(res, 200, { outcome: breached ? "rolled-back" : "canary-passed-advisory", publication: "none", observations: observations.length, persistedAt: state.persistedAt }); }
  if (action === "rollback") { state.activeCandidate = null; state.rolledBack = true; save(state); return response(res, 200, { rolledBack: true, publication: "none", persistedAt: state.persistedAt }); }
  if (action === "outbox") { const id = requireText(input.id, "id"); state.outbox.push(id); if (!state.delivered.includes(id)) state.delivered.push(id); save(state); return response(res, 200, { id, suppressedDuplicate: state.delivered.filter((x) => x === id).length === 1 && state.outbox.filter((x) => x === id).length > 1, delivered: state.delivered.length }); }
  if (action === "lease") { const owner = requireText(input.owner, "owner"); const ttlMs = requireTtl(input.ttlMs); const current = state.lease; const acquiredAt = now(); if (current && current.expiresAt > acquiredAt && current.owner !== owner) return response(res, 409, { error: "lease-held", failClosed: true, expiresAt: current.expiresAt, fencingToken: current.fencingToken }); const fencingToken = current && current.owner === owner ? current.fencingToken : (current?.fencingToken ?? 0) + 1; state.lease = { owner, expiresAt: acquiredAt + ttlMs, fencingToken }; save(state); return response(res, 200, { lease: "acquired", owner, expiresAt: state.lease.expiresAt, fencingToken, acquiredAt }); }
  if (action === "snapshot") { const name = requireText(input.name, "name"); state.snapshots[name] = clone(state); writeFileSync(join(root, "snapshots", `${name}.json`), JSON.stringify(state.snapshots[name]), "utf8"); save(state); return response(res, 200, { snapshot: name, persistedAt: state.persistedAt }); }
  if (action === "restore") { const name = requireText(input.name, "name"); let snapshot: unknown; try { snapshot = state.snapshots[name] ?? JSON.parse(readFileSync(join(root, "snapshots", `${name}.json`), "utf8")); } catch { throw new Error("snapshot is unreadable"); } if (!isState(snapshot)) throw new Error("snapshot is malformed"); state = clone(snapshot); save(state); return response(res, 200, { restored: name, restoredPersistedAt: (snapshot as State).persistedAt, persistedAt: state.persistedAt }); }
  return response(res, 404, { error: "unknown action" });
} catch (error) { return response(res, 400, { error: error instanceof Error ? error.message : "invalid request" }); } });
if (cleanupOnly) cleanupS10Runtime(root);
else server.listen({ host: "127.0.0.1", port }, () => process.stdout.write(`${JSON.stringify({ event: "ready", port: (server.address() as { port: number }).port })}\n`));
function shutdown() { server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 2_000).unref(); }
process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
export function cleanupS10Runtime(runtimeRoot: string) {
  if (resolve(runtimeRoot) !== root) throw new Error("cleanup is limited to this daemon's runtime root.");
  rmSync(assertRuntimeRoot(root, runtimeToken, true), { recursive: true, force: true });
}
