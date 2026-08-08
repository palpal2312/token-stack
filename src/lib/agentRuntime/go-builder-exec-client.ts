// Go Builder Execution Authority HTTP Client
//
// This client calls the Go daemon's builder execution API when
// SEN_GO_BUILDER_EXEC_AUTHORITY=1. It provides the Node-to-Go bridge
// for Phase 08 Step 7 write authority cutover.

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
  return process.env.SEN_DAEMON_URL ?? "http://127.0.0.1:3738";
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
      headers: { "Content-Type": "application/json" },
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
