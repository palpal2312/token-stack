// Go Builder Execution Authority HTTP Client
//
// This client calls the Go daemon's builder execution API when
// SEN_GO_BUILDER_EXEC_AUTHORITY=1. It provides the Node-to-Go bridge
// for Phase 08 Step 7 write authority cutover.
//
// The daemon enforces the same token + capability nonce as sen-api; the
// shared credential comes from goApiProxy (sen.env / env). When no credential
// is configured, requests go out without auth headers and the daemon fails
// closed with 401/403 — intended, never bypass it.

import { goApiAuthHeaders } from "@/lib/goApiProxy";
import { parseRuntimeSlots, type OrcaRuntimeSlotsDTO } from "./orca-slot-client";

export interface GoBuilderExecRequest {
  taskId: string;
  attemptId: string;
  builderId: string;
  worktreePath: string;
  prompt: string;
  model?: string;
  effort?: string;
  sessionId?: string;
  runId: string;
  traceId: string;
  ownerId?: string;
  env?: Record<string, string>;
}

export interface GoBuilderExecResponse {
  ok: boolean;
  paneId?: string;
  sessionId?: string;
  durationMs: number;
  usage?: { input?: number; output?: number };
  error?: string;
}

export type GoRuntimeStatus = "pending" | "attached" | "completed" | "failed" | "cancelled";

export interface GoRuntimeAttempt {
  attempt_id: string;
  task_id: string;
  builder_id: string;
  pane_id: string;
  status: GoRuntimeStatus;
  lease_generation: number;
  attached_at: string;
  last_heartbeat_at: string;
  last_output_ref?: string;
  terminal_kind?: string;
  terminal_at: string;
  terminal_summary?: string;
}

export interface GoRuntimeProjectionResponse {
  projection_version: string;
  attempts: GoRuntimeAttempt[];
}

const GO_RUNTIME_STATUSES = new Set<GoRuntimeStatus>([
  "pending", "attached", "completed", "failed", "cancelled",
]);

function isGoRuntimeAttempt(value: unknown): value is GoRuntimeAttempt {
  if (!value || typeof value !== "object") return false;
  const attempt = value as Partial<GoRuntimeAttempt>;
  return typeof attempt.attempt_id === "string" && attempt.attempt_id.length > 0
    && typeof attempt.task_id === "string" && attempt.task_id.length > 0
    && typeof attempt.builder_id === "string" && attempt.builder_id.length > 0
    && typeof attempt.pane_id === "string" && attempt.pane_id.length > 0
    && typeof attempt.status === "string" && GO_RUNTIME_STATUSES.has(attempt.status as GoRuntimeStatus)
    && typeof attempt.lease_generation === "number" && Number.isSafeInteger(attempt.lease_generation) && attempt.lease_generation > 0
    && typeof attempt.attached_at === "string"
    && typeof attempt.last_heartbeat_at === "string"
    && typeof attempt.terminal_at === "string";
}

function daemonEndpoint(): string {
  const configured = process.env.SEN_DAEMON_URL;
  if (!configured) return "http://127.0.0.1:3738";
  try {
    const url = new URL(configured);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]", "::1"].includes(host)) {
      throw new Error("SEN_DAEMON_URL must use loopback HTTP");
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return "http://127.0.0.1:3738";
  }
}

/**
 * Execute a governed builder turn via Go daemon authority.
 *
 * This is the Phase 08 Step 7 compatibility bridge. When the feature flag
 * SEN_GO_BUILDER_EXEC_AUTHORITY=1 is set, builder-execution.ts routes
 * through this client instead of the legacy Node path.
 */
export async function executeViaGoAuthority(
  req: GoBuilderExecRequest,
): Promise<GoBuilderExecResponse> {
  const endpoint = daemonEndpoint();

  try {
    const res = await fetch(`${endpoint}/api/v1/builder/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await goApiAuthHeaders()) },
      body: JSON.stringify({
        task_id: req.taskId,
        attempt_id: req.attemptId,
        builder_id: req.builderId,
        worktree_path: req.worktreePath,
        prompt: req.prompt,
        model: req.model,
        effort: req.effort,
        session_id: req.sessionId,
        run_id: req.runId,
        trace_id: req.traceId,
        owner_id: req.ownerId,
        env: req.env,
      }),
      signal: AbortSignal.timeout(180_000), // 3min timeout
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Go authority HTTP ${res.status}: ${text}`);
    }

    const data = await res.json();
    return {
      ok: data.ok ?? false,
      paneId: data.pane_id,
      sessionId: data.session_id,
      durationMs: data.duration_ms ?? 0,
      usage: data.usage,
      error: data.error,
    };
  } catch (err) {
    if (err instanceof Error) {
      throw new Error(`Go authority connection failed: ${err.message}`);
    }
    throw err;
  }
}

/** Read the daemon-lifetime runtime projection without authorizing any action. */
export async function readRuntimeProjection(): Promise<GoRuntimeProjectionResponse> {
  try {
    const res = await fetch(`${daemonEndpoint()}/api/v1/runtime/attempts`, {
      method: "GET",
      cache: "no-store",
      headers: { ...(await goApiAuthHeaders()) },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    const data = await res.json() as Partial<GoRuntimeProjectionResponse>;
    if (typeof data.projection_version !== "string"
      || !Array.isArray(data.attempts)
      || !data.attempts.every(isGoRuntimeAttempt)) {
      throw new Error("daemon returned an invalid runtime projection response");
    }
    return { projection_version: data.projection_version, attempts: data.attempts };
  } catch (err) {
    if (err instanceof Error) {
      throw new Error(`Go runtime projection connection failed: ${err.message}`);
    }
    throw err;
  }
}

/** Read the daemon runtime-slots DTO without authorizing any action. */
export async function readRuntimeSlots(): Promise<OrcaRuntimeSlotsDTO> {
  try {
    const res = await fetch(`${daemonEndpoint()}/api/v1/runtime/slots`, {
      method: "GET",
      cache: "no-store",
      headers: { ...(await goApiAuthHeaders()) },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    const payload: unknown = await res.json();
    const dto = parseRuntimeSlots(payload);
    if (!dto) throw new Error("daemon returned an invalid runtime slots response");
    return dto;
  } catch (err) {
    if (err instanceof Error) {
      throw new Error(`Go runtime slots connection failed: ${err.message}`);
    }
    throw err;
  }
}

// --------------------------------------------------- codespace summary stream

export interface GoCodeSpaceSummary {
  task_id: string;
  attempt_id: string;
  builder_id: string;
  status: string;
  updated_at: string;
  worktree_id?: string | null;
  checkpoint?: string | null;
  blocker?: string | null;
  artifact_refs?: string[] | null;
}

export interface GoCodeSpaceSummaryResponse {
  projection_version: string;
  summaries: GoCodeSpaceSummary[];
}

function isGoCodeSpaceSummary(value: unknown): value is GoCodeSpaceSummary {
  if (!value || typeof value !== "object") return false;
  const s = value as Partial<GoCodeSpaceSummary>;
  if (typeof s.task_id !== "string" || s.task_id.length === 0) return false;
  if (typeof s.attempt_id !== "string" || s.attempt_id.length === 0) return false;
  if (typeof s.builder_id !== "string" || s.builder_id.length === 0) return false;
  if (typeof s.status !== "string" || s.status.length === 0) return false;
  if (typeof s.updated_at !== "string") return false;
  for (const opt of [s.worktree_id, s.checkpoint, s.blocker]) {
    if (opt !== undefined && opt !== null && typeof opt !== "string") return false;
  }
  if (s.artifact_refs !== undefined && s.artifact_refs !== null
    && (!Array.isArray(s.artifact_refs) || !s.artifact_refs.every((r) => typeof r === "string"))) {
    return false;
  }
  return true;
}

/**
 * Read the daemon's structured codespace summary projection. Throws on
 * unreachable, timeout, non-2xx, or invalid shape — exactly like
 * readRuntimeProjection — so the caller can degrade to attempt cards only.
 */
export async function readCodeSpaceSummary(): Promise<GoCodeSpaceSummaryResponse> {
  try {
    const res = await fetch(`${daemonEndpoint()}/api/v1/codespace/summary`, {
      method: "GET",
      cache: "no-store",
      headers: { ...(await goApiAuthHeaders()) },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    const data = await res.json() as Partial<GoCodeSpaceSummaryResponse>;
    if (typeof data.projection_version !== "string"
      || !Array.isArray(data.summaries)
      || !data.summaries.every(isGoCodeSpaceSummary)) {
      throw new Error("daemon returned an invalid codespace summary response");
    }
    return { projection_version: data.projection_version, summaries: data.summaries };
  } catch (err) {
    if (err instanceof Error) {
      throw new Error(`Go codespace summary connection failed: ${err.message}`);
    }
    throw err;
  }
}

// ------------------------------------------------------- herdr snapshot cache

export interface GoHerdrSnapshotCacheInfo {
  generated_at: string;
  ttl_ms: number;
  age_ms: number;
  stale: boolean;
  source_revision: number;
  payload_hash: string;
  last_refresh_error: string | null;
}

export interface GoHerdrSnapshotStatus {
  installed: boolean;
  bin: string | null;
  version: string | null;
  running: boolean;
  error: string | null;
}

export interface GoHerdrSnapshotCacheResponse {
  /** Raw `herdr api snapshot` snapshot object, or null when herdr itself is down. */
  snapshot: Record<string, unknown> | null;
  status: GoHerdrSnapshotStatus;
  cache: GoHerdrSnapshotCacheInfo;
}

export interface GoSandboxWorkerProfile {
  provider_id: string;
  tier: string;
  is_sandbox: boolean;
  execution_modes: string[];
  capabilities: string[];
  status: string;
  reason?: string;
  evidence_ref?: string;
}

export interface GoSandboxWorker {
  worker_id: string;
  profile: GoSandboxWorkerProfile;
  health: string;
  effective_health: string;
  active_sandboxes: number;
  last_seen_at: string;
  capability_checks: Array<{ name: string; status: string; detail?: string; evidence_ref?: string }>;
}

export interface GoSandboxWorkersResponse {
  workers: GoSandboxWorker[];
}

export interface GoExecutionPreference {
  workspace_id: string;
  requested_mode: "host" | "agentenv";
  effective_mode: "host" | "agentenv";
  resolution_reason: string;
  updated_at?: string;
}

export interface GoExecutionPreferenceFailure {
  requested_mode: "host" | "agentenv";
  reason_codes: string[];
  detail: string;
}

export class GoExecutionPreferenceError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reasonCodes: string[] = [],
    readonly requestedMode?: "host" | "agentenv",
  ) {
    super(message);
    this.name = "GoExecutionPreferenceError";
  }
}

function isExecutionMode(value: unknown): value is "host" | "agentenv" {
  return value === "host" || value === "agentenv";
}

function isSandboxWorker(value: unknown): value is GoSandboxWorker {
  if (!value || typeof value !== "object") return false;
  const worker = value as Partial<GoSandboxWorker>;
  const profile = worker.profile as Partial<GoSandboxWorkerProfile> | undefined;
  return typeof worker.worker_id === "string" && worker.worker_id.length > 0
    && typeof profile?.provider_id === "string"
    && typeof profile.tier === "string"
    && typeof profile.is_sandbox === "boolean"
    && Array.isArray(profile.execution_modes)
    && profile.execution_modes.every((mode) => typeof mode === "string")
    && Array.isArray(profile.capabilities)
    && profile.capabilities.every((capability) => typeof capability === "string")
    && typeof profile.status === "string"
    && typeof worker.health === "string"
    && typeof worker.effective_health === "string"
    && Number.isSafeInteger(worker.active_sandboxes)
    && typeof worker.last_seen_at === "string"
    && Array.isArray(worker.capability_checks);
}

function isExecutionPreference(value: unknown): value is GoExecutionPreference {
  if (!value || typeof value !== "object") return false;
  const pref = value as Partial<GoExecutionPreference>;
  return typeof pref.workspace_id === "string"
    && isExecutionMode(pref.requested_mode)
    && isExecutionMode(pref.effective_mode)
    && typeof pref.resolution_reason === "string";
}

export async function readExecutionPreference(workspaceId = "default"): Promise<GoExecutionPreference> {
  try {
    const res = await fetch(`${daemonEndpoint()}/api/v1/workspace/${encodeURIComponent(workspaceId)}/execution-preference`, {
      method: "GET",
      cache: "no-store",
      headers: { ...(await goApiAuthHeaders()) },
      signal: AbortSignal.timeout(5_000),
    });
    const data = await res.json().catch(() => null) as GoExecutionPreferenceFailure | GoExecutionPreference | null;
    if (res.status === 409 && data && "reason_codes" in data) {
      throw new GoExecutionPreferenceError(data.detail || data.reason_codes.join(", "), res.status, data.reason_codes, data.requested_mode);
    }
    if (!res.ok || !isExecutionPreference(data)) throw new GoExecutionPreferenceError(`HTTP ${res.status}`, res.status);
    return data;
  } catch (err) {
    if (err instanceof GoExecutionPreferenceError) throw err;
    throw new GoExecutionPreferenceError(`Go execution preference connection failed: ${err instanceof Error ? err.message : String(err)}`, 503);
  }
}

export async function writeExecutionPreference(
  requestedMode: "host" | "agentenv",
  workspaceId = "default",
): Promise<GoExecutionPreference> {
  try {
    const res = await fetch(`${daemonEndpoint()}/api/v1/workspace/${encodeURIComponent(workspaceId)}/execution-preference`, {
      method: "PUT",
      headers: { "content-type": "application/json", ...(await goApiAuthHeaders()) },
      body: JSON.stringify({ requested_mode: requestedMode }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json().catch(() => null) as GoExecutionPreferenceFailure | GoExecutionPreference | null;
    if (res.status === 409 && data && "reason_codes" in data) {
      throw new GoExecutionPreferenceError(data.detail || data.reason_codes.join(", "), res.status, data.reason_codes, data.requested_mode);
    }
    if (!res.ok || !isExecutionPreference(data)) throw new GoExecutionPreferenceError(`HTTP ${res.status}`, res.status);
    return data;
  } catch (err) {
    if (err instanceof GoExecutionPreferenceError) throw err;
    throw new GoExecutionPreferenceError(`Go execution preference update failed: ${err instanceof Error ? err.message : String(err)}`, 503);
  }
}

function isGoHerdrSnapshotCacheResponse(value: unknown): value is GoHerdrSnapshotCacheResponse {
  if (!value || typeof value !== "object") return false;
  const r = value as Partial<GoHerdrSnapshotCacheResponse>;
  if (r.snapshot !== null && (typeof r.snapshot !== "object" || r.snapshot === undefined)) return false;
  const st = r.status;
  if (!st || typeof st !== "object"
    || typeof st.installed !== "boolean"
    || typeof st.running !== "boolean") return false;
  const c = r.cache;
  if (!c || typeof c !== "object"
    || typeof c.generated_at !== "string"
    || typeof c.ttl_ms !== "number"
    || typeof c.stale !== "boolean") return false;
  return true;
}

/**
 * Read the daemon's cached `herdr api snapshot` payload. Throws on unreachable,
 * timeout, non-2xx, or invalid shape — exactly like readRuntimeProjection — so
 * the caller can fall back to the legacy CLI spawn path. A 200 with
 * snapshot:null is authoritative (herdr itself is down) and does NOT throw.
 */
export async function readSandboxWorkers(): Promise<GoSandboxWorkersResponse> {
  try {
    const res = await fetch(`${daemonEndpoint()}/api/v1/sandbox/workers`, {
      method: "GET",
      cache: "no-store",
      headers: { ...(await goApiAuthHeaders()) },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as Partial<GoSandboxWorkersResponse>;
    if (!Array.isArray(data.workers) || !data.workers.every(isSandboxWorker)) {
      throw new Error("daemon returned an invalid worker response");
    }
    return { workers: data.workers };
  } catch (err) {
    throw new Error(`Go sandbox worker connection failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function readDaemonHerdrSnapshot(): Promise<GoHerdrSnapshotCacheResponse> {
  try {
    const res = await fetch(`${daemonEndpoint()}/api/v1/herdr/snapshot`, {
      method: "GET",
      cache: "no-store",
      headers: { ...(await goApiAuthHeaders()) },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    const data: unknown = await res.json();
    if (!isGoHerdrSnapshotCacheResponse(data)) {
      throw new Error("daemon returned an invalid herdr snapshot response");
    }
    return data;
  } catch (err) {
    if (err instanceof Error) {
      throw new Error(`Go herdr snapshot connection failed: ${err.message}`);
    }
    throw err;
  }
}

export async function readDaemonRuntimeSlots(): Promise<OrcaRuntimeSlotsDTO> {
  try {
    const res = await fetch(`${daemonEndpoint()}/api/v1/runtime/slots`, {
      method: "GET",
      cache: "no-store",
      headers: { ...(await goApiAuthHeaders()) },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    const data: unknown = await res.json();
    const parsed = parseRuntimeSlots(data);
    if (!parsed) {
      throw new Error("daemon returned an invalid runtime slots response");
    }
    return parsed;
  } catch (err) {
    if (err instanceof Error) {
      throw new Error(`Go runtime slots connection failed: ${err.message}`);
    }
    throw err;
  }
}

