import {
  LOCAL_CAPABILITIES,
  type LocalCapability,
  type RunRef,
  type ValidationResult,
  isNonEmptyString,
  isRecord,
} from "./contracts";

export const DASHBOARD_BOOTSTRAP_CAPABILITIES = ["read", "execute"] as const satisfies readonly LocalCapability[];
export const NONCE_BOUND_CAPABILITIES = [
  "approve",
  "configure",
  "release-override",
  "maintenance",
] as const satisfies readonly LocalCapability[];

export interface VerifiedActor extends RunRef<"local-user" | "local-service"> {
  authenticatedBy: "dashboard-token" | "loopback-session" | "system";
  verifiedAt: string;
}

export interface CapabilityGrant {
  id: string;
  actor: VerifiedActor;
  capabilities: LocalCapability[];
  issuedAt: string;
  expiresAt?: string;
  nonce?: string;
  revokedAt?: string;
}

export interface AuthorizationDecision {
  allowed: boolean;
  actor?: VerifiedActor;
  capability: LocalCapability;
  reason:
    | "allowed"
    | "invalid-grant"
    | "untrusted-grant"
    | "not-yet-valid"
    | "expired"
    | "revoked"
    | "missing-capability"
    | "nonce-required"
    | "nonce-mismatch";
}

export interface AuthorizationContext {
  /** Complete grants loaded from the trusted local store, keyed by grant ID. */
  trustedGrants: ReadonlyMap<string, CapabilityGrant>;
  /** One-time nonce issued for the privileged action and consumed by the caller. */
  expectedNonce?: string;
}

export function validateCapabilityGrant(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["CapabilityGrant must be an object"] };
  if (!isNonEmptyString(value.id)) errors.push("id is required");
  if (!isVerifiedActor(value.actor)) errors.push("actor is invalid");
  if (!Array.isArray(value.capabilities)
    || value.capabilities.length === 0
    || value.capabilities.some((capability) => !LOCAL_CAPABILITIES.includes(capability as LocalCapability))) {
    errors.push("capabilities must contain known local capabilities");
  } else if (new Set(value.capabilities).size !== value.capabilities.length) {
    errors.push("capabilities must not contain duplicates");
  } else if (value.capabilities.some((capability) => NONCE_BOUND_CAPABILITIES.includes(capability as typeof NONCE_BOUND_CAPABILITIES[number]))
    && !isNonEmptyString(value.nonce)) {
    errors.push("nonce is required for privileged capabilities");
  }
  if (!isIsoInstant(value.issuedAt)) errors.push("issuedAt must be an ISO-8601 UTC timestamp");
  if (value.expiresAt !== undefined && !isIsoInstant(value.expiresAt)) errors.push("expiresAt must be an ISO-8601 UTC timestamp");
  if (value.revokedAt !== undefined && !isIsoInstant(value.revokedAt)) errors.push("revokedAt must be an ISO-8601 UTC timestamp");
  if (value.nonce !== undefined && !isNonEmptyString(value.nonce)) errors.push("nonce must be non-empty when present");
  if (isIsoInstant(value.issuedAt) && isIsoInstant(value.expiresAt)
    && new Date(value.expiresAt).valueOf() <= new Date(value.issuedAt).valueOf()) {
    errors.push("expiresAt must be after issuedAt");
  }
  return { ok: errors.length === 0, errors };
}

export function authorizeCapability(
  grantId: unknown,
  capability: LocalCapability,
  context: AuthorizationContext,
  now = new Date(),
): AuthorizationDecision {
  if (!isNonEmptyString(grantId)) {
    return { allowed: false, capability, reason: "invalid-grant" };
  }
  const typed = context.trustedGrants.get(grantId);
  if (!typed) {
    return { allowed: false, capability, reason: "untrusted-grant" };
  }
  if (!validateCapabilityGrant(typed).ok) {
    return { allowed: false, capability, reason: "invalid-grant" };
  }
  if (typed.revokedAt) return { allowed: false, actor: typed.actor, capability, reason: "revoked" };
  if (new Date(typed.issuedAt).valueOf() > now.valueOf()
    || new Date(typed.actor.verifiedAt).valueOf() > now.valueOf()) {
    return { allowed: false, actor: typed.actor, capability, reason: "not-yet-valid" };
  }
  if (typed.expiresAt && new Date(typed.expiresAt).valueOf() <= now.valueOf()) {
    return { allowed: false, actor: typed.actor, capability, reason: "expired" };
  }
  if (!typed.capabilities.includes(capability)) {
    return { allowed: false, actor: typed.actor, capability, reason: "missing-capability" };
  }
  if (NONCE_BOUND_CAPABILITIES.includes(capability as typeof NONCE_BOUND_CAPABILITIES[number])) {
    if (!context.expectedNonce) {
      return { allowed: false, actor: typed.actor, capability, reason: "nonce-required" };
    }
    if (typed.nonce !== context.expectedNonce) {
      return { allowed: false, actor: typed.actor, capability, reason: "nonce-mismatch" };
    }
  }
  return { allowed: true, actor: typed.actor, capability, reason: "allowed" };
}

function isVerifiedActor(value: unknown): value is VerifiedActor {
  return isRecord(value)
    && (value.kind === "local-user" || value.kind === "local-service")
    && isNonEmptyString(value.id)
    && (value.authenticatedBy === "dashboard-token"
      || value.authenticatedBy === "loopback-session"
      || value.authenticatedBy === "system")
    && isIsoInstant(value.verifiedAt);
}

function isIsoInstant(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}
