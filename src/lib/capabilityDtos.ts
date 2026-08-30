/**
 * Phase 19 step 9a — frozen capability DTO mirrors.
 *
 * Canonical truth lives in Go: go/internal/capability (the 4 new DTOs) plus
 * the reused projection DTOs (go/internal/projections/runtime, .../codespace,
 * go/internal/herdradapter). This module is the single import surface for
 * Phase 19b: thin hand-maintained mirrors + runtime validators for the 4 new
 * DTOs, and re-exports of the existing mirrors so consumers import one module.
 * No codegen — the Go golden tests (internal/capability/dtos_test.go) are the
 * schema; keep these mirrors in lockstep when v1 gains additive fields.
 */

export const CAPABILITY_DTO_VERSION = "v1" as const;

// Reused DTOs — existing mirrors, re-exported for one-module import.
export type {
  GoRuntimeAttempt,
  GoRuntimeStatus,
  GoCodeSpaceSummary,
  GoHerdrSnapshotCacheInfo,
  GoHerdrSnapshotStatus,
} from "./agentRuntime/go-builder-exec-client";

// ------------------------------------------------------- TerminalAttachSession

/** Frozen enum — phase 19b TerminalAttachRequest/TerminalAttachEvent states. */
export type TerminalAttachState = "attaching" | "attached" | "detached" | "ended";

const TERMINAL_ATTACH_STATES = new Set<TerminalAttachState>([
  "attaching", "attached", "detached", "ended",
]);

export const TERMINAL_COLS_MIN = 20;
export const TERMINAL_COLS_MAX = 500;
export const TERMINAL_ROWS_MIN = 5;
export const TERMINAL_ROWS_MAX = 200;

/**
 * Attach-only handle to a daemon-owned terminal session. The UI holds ONLY
 * terminal_session_id — never a process/PTY object. No field mutates the
 * canonical Attempt lifecycle; detach decrements viewer_count only.
 */
export interface TerminalAttachSession {
  terminal_session_id: string;
  workspace_id: string;
  attempt_id: string;
  client_instance_id: string;
  attach_capability: string;
  capability_expires_at: string;
  last_seen_cursor: number;
  next_seq: number;
  sandbox_provider: string;
  sandbox_id: string;
  cols: number;
  rows: number;
  state: TerminalAttachState;
  created_at: string;
  last_attached_at: string;
  viewer_count: number;
}

export function isTerminalAttachSession(value: unknown): value is TerminalAttachSession {
  if (!value || typeof value !== "object") return false;
  const s = value as Partial<TerminalAttachSession>;
  return typeof s.terminal_session_id === "string" && s.terminal_session_id.length > 0
    && typeof s.workspace_id === "string" && s.workspace_id.length > 0
    && typeof s.attempt_id === "string" && s.attempt_id.length > 0
    && typeof s.client_instance_id === "string" && s.client_instance_id.length > 0
    && typeof s.attach_capability === "string"
    && typeof s.capability_expires_at === "string"
    && typeof s.last_seen_cursor === "number" && Number.isSafeInteger(s.last_seen_cursor)
    && typeof s.next_seq === "number" && Number.isSafeInteger(s.next_seq)
    && typeof s.sandbox_provider === "string"
    && typeof s.sandbox_id === "string"
    && typeof s.cols === "number" && s.cols >= TERMINAL_COLS_MIN && s.cols <= TERMINAL_COLS_MAX
    && typeof s.rows === "number" && s.rows >= TERMINAL_ROWS_MIN && s.rows <= TERMINAL_ROWS_MAX
    && typeof s.state === "string" && TERMINAL_ATTACH_STATES.has(s.state as TerminalAttachState)
    && typeof s.created_at === "string"
    && typeof s.last_attached_at === "string"
    && typeof s.viewer_count === "number" && Number.isSafeInteger(s.viewer_count) && s.viewer_count >= 0;
}

// --------------------------------------------------- ExecutionProviderProfile

/** Frozen enum — host mode is NOT a sandbox (see is_sandbox). */
export type ExecutionProviderTier =
  | "host-windows"
  | "production-linux-kvm"
  | "experimental-nested";

export type ExecutionProviderStatus = "available" | "degraded" | "unavailable";

/** Reuses sandbox.ExecutionMode vocabulary — no new enum. */
export type ExecutionMode = "host" | "agentenv";

const PROVIDER_TIERS = new Set<ExecutionProviderTier>([
  "host-windows", "production-linux-kvm", "experimental-nested",
]);
const PROVIDER_STATUSES = new Set<ExecutionProviderStatus>([
  "available", "degraded", "unavailable",
]);
const EXECUTION_MODES = new Set<ExecutionMode>(["host", "agentenv"]);

export interface ExecutionProviderProfile {
  provider_id: string;
  tier: ExecutionProviderTier;
  /** Explicit: host mode is NOT a sandbox; never present it as one. */
  is_sandbox: boolean;
  execution_modes: ExecutionMode[];
  os: string;
  arch: string;
  capabilities: string[];
  evidence_ref: string;
  status: ExecutionProviderStatus;
  reason?: string;
}

export function isExecutionProviderProfile(value: unknown): value is ExecutionProviderProfile {
  if (!value || typeof value !== "object") return false;
  const p = value as Partial<ExecutionProviderProfile>;
  return typeof p.provider_id === "string" && p.provider_id.length > 0
    && typeof p.tier === "string" && PROVIDER_TIERS.has(p.tier as ExecutionProviderTier)
    && typeof p.is_sandbox === "boolean"
    && Array.isArray(p.execution_modes)
    && p.execution_modes.every((m) => EXECUTION_MODES.has(m as ExecutionMode))
    && typeof p.os === "string"
    && typeof p.arch === "string"
    && Array.isArray(p.capabilities) && p.capabilities.every((c) => typeof c === "string")
    && typeof p.evidence_ref === "string"
    && typeof p.status === "string" && PROVIDER_STATUSES.has(p.status as ExecutionProviderStatus)
    && (p.reason === undefined || typeof p.reason === "string");
}

// ------------------------------------------------- WorkspaceExecutionPreference

/**
 * Requested-vs-effective mode split at workspace scope. requested_mode is the
 * user-set preference; effective_mode is policy-resolved at Attempt launch.
 */
export interface WorkspaceExecutionPreference {
  workspace_id: string;
  requested_mode: ExecutionMode;
  effective_mode: ExecutionMode;
  resolution_reason?: string;
  policy_ref?: string;
  updated_at: string;
}

export function isWorkspaceExecutionPreference(value: unknown): value is WorkspaceExecutionPreference {
  if (!value || typeof value !== "object") return false;
  const p = value as Partial<WorkspaceExecutionPreference>;
  return typeof p.workspace_id === "string" && p.workspace_id.length > 0
    && typeof p.requested_mode === "string" && EXECUTION_MODES.has(p.requested_mode as ExecutionMode)
    && typeof p.effective_mode === "string" && EXECUTION_MODES.has(p.effective_mode as ExecutionMode)
    && (p.resolution_reason === undefined || typeof p.resolution_reason === "string")
    && (p.policy_ref === undefined || typeof p.policy_ref === "string")
    && typeof p.updated_at === "string";
}

// ---------------------------------------------------------- OpenExternalResult

/** Frozen host-neutral launcher enum; Electron adds electron-shell in 19b. */
export type OpenExternalLauncher =
  | "cmd"
  | "windows-terminal"
  | "system-terminal"
  | "direct"
  | "electron-shell";

export type OpenExternalFailureReason =
  | "herdr_not_installed"
  | "spawn_failed"
  | "unsupported_host"
  | "none";

const OPEN_EXTERNAL_LAUNCHERS = new Set<OpenExternalLauncher>([
  "cmd", "windows-terminal", "system-terminal", "direct", "electron-shell",
]);
const OPEN_EXTERNAL_FAILURE_REASONS = new Set<OpenExternalFailureReason>([
  "herdr_not_installed", "spawn_failed", "unsupported_host", "none",
]);

/**
 * Frozen result of opening an external/system terminal. Formalizes the
 * informal {ok, via: cmd|direct, error} from api/herdr/open-external; the
 * current route is a compatibility shim mapping via -> launcher.
 * terminal_session_id is set when the opened terminal attaches a tracked
 * session under the same session authority (phase-19b D2).
 */
export interface OpenExternalResult {
  ok: boolean;
  launcher: OpenExternalLauncher;
  failure_reason: OpenExternalFailureReason;
  error?: string;
  terminal_session_id?: string;
}

export function isOpenExternalResult(value: unknown): value is OpenExternalResult {
  if (!value || typeof value !== "object") return false;
  const r = value as Partial<OpenExternalResult>;
  return typeof r.ok === "boolean"
    && typeof r.launcher === "string" && OPEN_EXTERNAL_LAUNCHERS.has(r.launcher as OpenExternalLauncher)
    && typeof r.failure_reason === "string"
    && OPEN_EXTERNAL_FAILURE_REASONS.has(r.failure_reason as OpenExternalFailureReason)
    && (r.error === undefined || typeof r.error === "string")
    && (r.terminal_session_id === undefined || typeof r.terminal_session_id === "string");
}
