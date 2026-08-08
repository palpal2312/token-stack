import type { RedactionClass } from "../llmops/contracts";

/**
 * Dify workflow profile (stored; includes secret API key).
 */
export interface DifyProfile {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  revisionId: string;
  revisions: DifyConnectionRevision[];
  studioLink?: string;
  tombstone?: boolean;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

/**
 * Public Dify profile (safe for browser/logs; no API key).
 */
export interface DifyPublicProfile {
  id: string;
  name: string;
  baseUrl: string;
  revisionId: string;
  studioLink?: string;
  tombstone?: boolean;
  createdAt: string;
  updatedAt: string;
  health?: DifyHealthStatus;
  info?: DifyWorkflowInfo;
  parameters?: DifyNormalizedParameter[];
  metadata?: Record<string, unknown>;
}

/**
 * Dify workflow info from GET /v1/info.
 */
export interface DifyWorkflowInfo {
  name: string;
  description?: string;
  tags?: string[];
}

/**
 * Dify health status.
 */
export type DifyHealthStatus = "healthy" | "degraded" | "offline" | "unauthorized" | "unknown";

/**
 * Normalized Dify parameter types.
 */
export type DifyParameterType =
  | "text"
  | "paragraph"
  | "number"
  | "select"
  | "boolean"
  | "file"
  | "file-list"
  | "unsupported";

/**
 * Normalized Dify parameter.
 */
export interface DifyNormalizedParameter {
  name: string;
  type: DifyParameterType;
  label?: string;
  description?: string;
  required?: boolean;
  defaultValue?: unknown;
  options?: Array<{ label: string; value: string }>;
  min?: number;
  max?: number;
  maxLength?: number;
  upstreamType?: string;
}

/**
 * Dify run correlation (local + upstream identifiers).
 */
export interface DifyRunCorrelation {
  runId: string;
  profileId: string;
  submissionId: string;
  user: string;
  taskId?: string;
  workflowRunId?: string;
  upstreamStatus?: string;
  submittedAt: string;
  reconciledAt?: string;
}

/**
 * Dify normalized lifecycle event.
 */
export interface DifyLifecycleEvent {
  kind: "workflow_started" | "workflow_paused" | "workflow_resumed" | "workflow_succeeded" | "workflow_failed" | "workflow_stopped";
  workflowRunId?: string;
  taskId?: string;
  at: string;
  metadata?: Record<string, unknown>;
}

/**
 * Dify artifact manifest (bounded reference to spooled output).
 */
export interface DifyArtifactManifest {
  key: string;
  type: string;
  sizeBytes: number;
  omitted: boolean;
  redactionClass: RedactionClass;
}

/**
 * Dify profile registry envelope.
 */
export interface DifyProfileRegistry {
  version: 1;
  profiles: DifyProfile[];
  createdAt: string;
  updatedAt: string;
}

export type DifyPublicMetadata = Record<string, string | number | boolean | null>;

/** Runtime guard for browser/log-safe profiles. It deliberately rejects secret-shaped keys recursively. */
export function validateDifyPublicProfile(value: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, errors: ["public profile must be an object"] };
  const profile = value as Record<string, unknown>;
  for (const key of ["id", "name", "baseUrl", "revisionId", "createdAt", "updatedAt"]) {
    if (typeof profile[key] !== "string" || !profile[key].trim()) errors.push(`${key} is required`);
  }
  if (containsSecretShape(profile)) errors.push("public profile must not contain secret material");
  return { ok: errors.length === 0, errors };
}

/** Converts stored configuration to its only browser-safe representation. */
export function toDifyPublicProfile(profile: DifyProfile): DifyPublicProfile {
  const { apiKey: _apiKey, revisions: _revisions, ...publicProfile } = profile;
  return structuredClone(publicProfile);
}

export type DifyLifecycleProjection = {
  status: "queued" | "running" | "blocked" | "succeeded" | "failed" | "cancelled" | "orphaned";
  terminal: boolean;
  retryable?: boolean;
  metadata?: { partial?: true };
};

/** Canonical projection used by later transport code; no raw upstream body is retained. */
export function projectDifyLifecycle(kind: DifyLifecycleEvent["kind"] | "partial_succeeded" | "unknown_outcome"): DifyLifecycleProjection {
  switch (kind) {
    case "workflow_started":
    case "workflow_resumed": return { status: "running", terminal: false };
    case "workflow_paused": return { status: "blocked", terminal: false };
    case "workflow_succeeded": return { status: "succeeded", terminal: true };
    case "workflow_failed": return { status: "failed", terminal: true };
    case "workflow_stopped": return { status: "cancelled", terminal: true };
    case "partial_succeeded": return { status: "failed", terminal: true, retryable: false, metadata: { partial: true } };
    case "unknown_outcome": return { status: "orphaned", terminal: true, retryable: false };
  }
}

function containsSecretShape(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsSecretShape);
  return Object.entries(value as Record<string, unknown>).some(([key, item]) =>
    /(?:api[-_]?key|authorization|password|secret|token)/i.test(key) || containsSecretShape(item));
}

/**
 * Dify connection revision record.
 */
export interface DifyConnectionRevision {
  revisionId: string;
  profileId: string;
  baseUrl: string;
  apiKey: string;
  keyHint: string;
  validated?: {
    serviceApiBase: string;
    protocolVersion: string;
  };
  lastValidatedAt?: string;
  createdAt: string;
  referencedBy: string[];
  active: boolean;
}
