import { isNonEmptyString, isRecord, type ValidationResult } from "./contracts";
import { classifyPayloadKey } from "./redaction";

export const SECRET_REF_SCHEMES = ["env", "keychain", "managed"] as const;
export type SecretRefScheme = (typeof SECRET_REF_SCHEMES)[number];

export interface SecretRef {
  scheme: SecretRefScheme;
  id: string;
  version?: string;
}

export interface SecretHealth {
  ref: SecretRef;
  status: "available" | "missing" | "stale" | "error";
  checkedAt: string;
  detailCode?: "not-found" | "access-denied" | "version-mismatch" | "provider-error";
}

export type SecretBackupContract =
  | { mode: "portable-redacted"; requiredRefs: SecretRef[] }
  | {
      mode: "disaster-recovery-encrypted";
      requiredRefs: SecretRef[];
      encryption: { algorithm: "aes-256-gcm"; keyRef: SecretRef };
    };

export function validateSecretRef(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["SecretRef must be an object"] };
  if (!SECRET_REF_SCHEMES.includes(value.scheme as SecretRefScheme)) errors.push("scheme is invalid");
  if (!isOpaqueId(value.id)) errors.push("id must be an opaque identifier");
  if (value.version !== undefined && !isOpaqueId(value.version)) errors.push("version must be an opaque identifier");
  if (containsSecretBearingField(value)) errors.push("SecretRef must not contain plaintext secret fields");
  return { ok: errors.length === 0, errors };
}

export function validateSecretHealth(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["SecretHealth must be an object"] };
  if (!validateSecretRef(value.ref).ok) errors.push("ref is invalid");
  if (!["available", "missing", "stale", "error"].includes(String(value.status))) errors.push("status is invalid");
  if (!isIsoInstant(value.checkedAt)) errors.push("checkedAt must be an ISO-8601 UTC timestamp");
  if (value.detailCode !== undefined
    && !["not-found", "access-denied", "version-mismatch", "provider-error"].includes(String(value.detailCode))) {
    errors.push("detailCode is invalid");
  }
  if (value.message !== undefined) errors.push("SecretHealth uses detailCode instead of free-form message");
  if (containsSecretBearingField(value, new Set(["ref"]))) errors.push("SecretHealth must not contain plaintext secret fields");
  return { ok: errors.length === 0, errors };
}

export function validateSecretBackupContract(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["SecretBackupContract must be an object"] };
  if (containsSecretBearingField(value, new Set(["requiredRefs", "encryption"]))) {
    errors.push("backup contract must not contain plaintext secret fields");
  }
  if (!Array.isArray(value.requiredRefs) || value.requiredRefs.some((ref) => !validateSecretRef(ref).ok)) {
    errors.push("requiredRefs are invalid");
  }
  if (value.mode === "portable-redacted") {
    if (value.encryption !== undefined) errors.push("portable-redacted backups must not contain encryption material");
  } else if (value.mode === "disaster-recovery-encrypted") {
    if (!isRecord(value.encryption)
      || value.encryption.algorithm !== "aes-256-gcm"
      || !validateSecretRef(value.encryption.keyRef).ok
      || containsSecretBearingField(value.encryption, new Set(["keyRef"]))) {
      errors.push("encrypted backups require aes-256-gcm and a valid keyRef");
    }
  } else {
    errors.push("mode is invalid");
  }
  return { ok: errors.length === 0, errors };
}

export function formatSecretRef(ref: SecretRef): string {
  const validation = validateSecretRef(ref);
  if (!validation.ok) throw new Error(validation.errors.join("; "));
  return `secret://${ref.scheme}/${encodeURIComponent(ref.id)}${ref.version ? `@${encodeURIComponent(ref.version)}` : ""}`;
}

function isOpaqueId(value: unknown): value is string {
  return isNonEmptyString(value)
    && value.length <= 200
    && !/[\s?#/\\]/.test(value)
    && !/(?:bearer|sk-|-----begin)/i.test(value);
}

function containsSecretBearingField(
  value: unknown,
  allowedReferenceKeys = new Set<string>(),
  seen = new WeakSet<object>(),
): boolean {
  if (value === null || typeof value !== "object") return false;
  if (seen.has(value)) return true;
  seen.add(value);
  if (Array.isArray(value)) {
    return value.some((item) => containsSecretBearingField(item, allowedReferenceKeys, seen));
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (!allowedReferenceKeys.has(key)
      && (classifyPayloadKey(key) === "secret"
        || /(?:^|[_-])(?:value|plaintext|raw[_-]?key|secret[_-]?value)(?:$|[_-])/i.test(normalizeKey(key)))) {
      return true;
    }
    if (containsSecretBearingField(item, allowedReferenceKeys, seen)) return true;
  }
  return false;
}

function normalizeKey(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1_$2");
}

function isIsoInstant(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}
