/** Disposable S10 drill daemon. It accepts only a caller-owned temp root. */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

type State = { generation: number; backendAvailable: boolean; activeCandidate: string | null; approvals: string[]; outbox: string[]; delivered: string[]; leaseUpdatedAt: number; rolledBack: boolean; snapshots: Record<string, State> };
const now = () => Date.now();
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const rootArg = process.argv.indexOf("--runtime-root");
const portArg = process.argv.indexOf("--port");
if (rootArg < 0 || !process.argv[rootArg + 1]) throw new Error("--runtime-root must be explicitly supplied.");
const root = resolve(process.argv[rootArg + 1]);
if (!root.includes("s10-")) throw new Error("runtime root must be a named s10 test directory.");
const port = portArg >= 0 ? Number(process.argv[portArg + 1]) : 0;
if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error("port must be valid.");
const stateFile = join(root, "state", "state.json");
for (const dir of [join(root, "state"), join(root, "outbox"), join(root, "lease"), join(root, "snapshots")]) mkdirSync(dir, { recursive: true });
function load(): State { try { return JSON.parse(readFileSync(stateFile, "utf8")) as State; } catch { return { generation: 0, backendAvailable: true, activeCandidate: null, approvals: [], outbox: [], delivered: [], leaseUpdatedAt: now(), rolledBack: false, snapshots: {} }; } }
function save(state: State) { const temp = `${stateFile}.tmp`; writeFileSync(temp, JSON.stringify(state), "utf8"); renameSync(temp, stateFile); }
let state = load(); state.generation++; save(state);
function response(res: ServerResponse, code: number, body: unknown) { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); }
async function body(req: IncomingMessage): Promise<Record<string, unknown>> { let raw = ""; for await (const part of req) raw += part; if (raw.length > 16_384) throw new Error("payload too large"); return raw ? JSON.parse(raw) as Record<string, unknown> : {}; }
function requireText(value: unknown, name: string) { if (typeof value !== "string" || !/^[a-z0-9-]{1,64}$/.test(value)) throw new Error(`${name} invalid`); return value; }
const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") return response(res, 200, { ok: true, generation: state.generation, loopbackOnly: true, legacyWriter: "disabled", phase21: "blocked" });
    if (req.method === "GET" && req.url === "/status") return response(res, 200, { generation: state.generation, backendAvailable: state.backendAvailable, activeCandidate: state.activeCandidate, delivered: state.delivered.length, rolledBack: state.rolledBack });
    if (req.method !== "POST" || !req.url?.startsWith("/action/")) return response(res, 404, { error: "not found" });
    const input = await body(req); const action = req.url.slice("/action/".length);
    if (action === "backend") { state.backendAvailable = input.available === true; save(state); return response(res, 200, { backendAvailable: state.backendAvailable }); }
    if (!state.backendAvailable) return response(res, 503, { error: "backend-unavailable", failClosed: true });
    if (action === "approval") { const candidate = requireText(input.candidate, "candidate"); if (input.decision !== "approve" && input.decision !== "reject") throw new Error("decision invalid"); if (input.decision === "approve") state.approvals.push(candidate); else state.activeCandidate = null; save(state); return response(res, 200, { decision: input.decision, noOp: input.decision === "reject" }); }
    if (action === "canary") { const candidate = requireText(input.candidate, "candidate"); const observations = input.observations; if (!state.approvals.includes(candidate)) return response(res, 409, { error: "approval-required", failClosed: true }); if (!Array.isArray(observations) || observations.length < 1 || observations.length > 5) throw new Error("observations must be bounded"); const breached = observations.some((x) => typeof x !== "object" || x === null || Number((x as Record<string, unknown>).errorRate) > .05); state.activeCandidate = breached ? null : candidate; state.rolledBack = breached; save(state); return response(res, 200, { outcome: breached ? "rolled-back" : "canary-passed-advisory", publication: "none", observations: observations.length }); }
    if (action === "rollback") { state.activeCandidate = null; state.rolledBack = true; save(state); return response(res, 200, { rolledBack: true, publication: "none" }); }
    if (action === "outbox") { const id = requireText(input.id, "id"); state.outbox.push(id); if (!state.delivered.includes(id)) state.delivered.push(id); save(state); return response(res, 200, { id, suppressedDuplicate: state.delivered.filter((x) => x === id).length === 1 && state.outbox.filter((x) => x === id).length > 1, delivered: state.delivered.length }); }
    if (action === "lease") { const stale = input.stale === true; if (stale) return response(res, 409, { error: "lease-stale", failClosed: true }); state.leaseUpdatedAt = now(); save(state); return response(res, 200, { lease: "fresh" }); }
    if (action === "snapshot") { const name = requireText(input.name, "name"); state.snapshots[name] = clone(state); writeFileSync(join(root, "snapshots", `${name}.json`), JSON.stringify(state.snapshots[name]), "utf8"); save(state); return response(res, 200, { snapshot: name }); }
    if (action === "restore") { const name = requireText(input.name, "name"); const snapshot = state.snapshots[name] ?? JSON.parse(readFileSync(join(root, "snapshots", `${name}.json`), "utf8")) as State; state = clone(snapshot); save(state); return response(res, 200, { restored: name }); }
    return response(res, 404, { error: "unknown action" });
  } catch (error) { return response(res, 400, { error: error instanceof Error ? error.message : "invalid request" }); }
});
server.listen({ host: "127.0.0.1", port }, () => process.stdout.write(`${JSON.stringify({ event: "ready", port: (server.address() as { port: number }).port })}\n`));
function shutdown() { server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 2_000).unref(); }
process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
export function cleanupS10Runtime(runtimeRoot: string) { const target = resolve(runtimeRoot); if (!target.includes("s10-")) throw new Error("refusing cleanup outside named s10 runtime root"); rmSync(target, { recursive: true, force: true }); }
