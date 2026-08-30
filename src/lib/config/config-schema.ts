/**
 * Phase 19a U5 — client contract for the versioned configuration engine.
 *
 * The authorizing schema/resolution/validation/audit contract is OWNED and
 * returned by Go (`go/internal/configschema/`, PROPOSED). The app-router
 * renderer never authorizes or validates — Go repeats every check. This module
 * is the thin CONSUMER-SHAPED mirror of the public config DTOs the phase file
 * names (`ConfigSchema`, `EffectiveConfigExplanation`, `RuntimeProfileDescriptor`),
 * plus the pure sentinel / unknown-field helpers the settings UI needs. No Go
 * endpoint exists in this run, so the read path is a typed snapshot; the write
 * endpoint is the deferred A-coordinated part (there is NO save POST here).
 *
 * Pure and side-effect free: no React, no Next, no Node — unit-testable under
 * `node --test --import tsx`.
 */
export const CONFIG_SCHEMA_VERSION = 1 as const;
export const CAPABILITY_REGISTRY_VERSION = 1 as const;

/**
 * Opaque token the server uses to tell the browser "this secret EXISTS but its
 * value is not transmitted". The browser must never round-trip a real secret;
 * an untouched secret is submitted back as a "preserve" marker so it can not
 * become a stored credential. Values here are intentionally unprintable.
 */
export const SECRET_SENTINEL_UNTOUCHED = "\u0004news:secret:untouched";
/** Explicit user intent to delete an existing secret. */
export const SECRET_SENTINEL_CLEARED = "\u0004news:secret:cleared";
/** How an untouched secret is rendered in the form (never the real value). */
export const SECRET_EDIT_MASK = "••••••";

/** Field / sub-scope kind a `ConfigFieldSchema` may declare. */
export type ConfigFieldKind =
  | "string"
  | "number"
  | "boolean"
  | "choice"
  | "secret"
  | "computed"
  | "unsupported"
  | "experimental";

/** Impact a field's change has on live work (Phase 19a "Configuration layering"). */
export type ConfigImpact =
  | "future-attempts-only"
  | "requires-restart"
  | "blocked-running-attempts"
  | "security-downgrade";

/** Workspace vs user-preference scope for a config section. */
export type ConfigScope = "workspace" | "user";

export interface ConfigFieldChoice {
  value: string;
  label?: string;
}

export interface ConfigFieldSchema {
  /** Stable field key. */
  key: string;
  label?: string;
  kind: ConfigFieldKind;
  /** Host capability the field needs to be editable (map to CapabilityRegistryDTO). */
  requiredCapability?: string;
  /** Permission the field needs to be editable. */
  requiredPermission?: string;
  /**
   * Present on `computed` / `unsupported` / `experimental` fields — the EXACT
   * reason shown on the disabled control. Never a hard-coded UI label set: it
   * comes from the server-provided schema/capability data.
   */
  unsupportedReason?: string;
  defaultValue?: unknown;
  choices?: readonly ConfigFieldChoice[];
  /** When set, editing this field implies this impact (drives restart warnings). */
  impact?: ConfigImpact;
}

export interface ConfigSchemaDTO {
  schemaId: string;
  /** Bump on any breaking shape change; a consumer must reject a newer version it cannot render. */
  version: number;
  scope: ConfigScope;
  fields: readonly ConfigFieldSchema[];
  /** Ordered migrations the server supports, newest first when multiple. */
  migrations?: readonly { from: number; to: number; notes?: string }[];
  /** Section this schema feeds (matches a module `settingsSections` token). */
  sectionToken?: string;
}

/** One record of the server-provided capability registry (Phase 19a layering rule 2). */
export interface CapabilityEntryDTO {
  id: string;
  /** Present == the host/workspace actually has this capability right now. */
  present: boolean;
  /** Exact reason when present === false (unsupported / forbidden / not-configured). */
  reason?: string;
}

/**
 * The capability registry is DATA returned by Go, not a hard-coded UI guess.
 * `src/lib/config/capability-registry.ts` only interprets these records.
 */
export interface CapabilityRegistryDTO {
  version: number;
  /** Deterministic digest of the capability set (part of the effective-config digest). */
  digest: string;
  capabilities: readonly CapabilityEntryDTO[];
}

export interface ConfigSnapshotDTO {
  schema: ConfigSchemaDTO;
  capabilities: CapabilityRegistryDTO;
  /** Current stored values keyed by field key (secrets carry the UNTOUCHED sentinel). */
  current: Record<string, unknown>;
  /** Settings sections contributed by the shell modules, in nav order, for grouping. */
  sections: readonly { token: string; moduleId: string; label: string }[];
}

// --- Secret sentinel helpers -------------------------------------------------

export type SecretViewState = "untouched" | "cleared" | "not-secret";

/** Classify a value against the secret sentinels. Untouched=present-not-sent, cleared=explicit delete. */
export function secretState(value: unknown): SecretViewState {
  if (value === SECRET_SENTINEL_UNTOUCHED) return "untouched";
  if (value === SECRET_SENTINEL_CLEARED) return "cleared";
  return "not-secret";
}

/** Render a secret value: masked when present, never the raw string. */
export function renderSecretValue(state: SecretViewState): string {
  if (state === "untouched") return SECRET_EDIT_MASK;
  if (state === "cleared") return " ";
  return "";
}

/** Emit the "preserve existing" marker for an untouched secret on save — never the sentinel or a real value. */
export function secretPreserveMarker(): unknown | null {
  return null; // server treats null secret-ref as "keep prior"
}

// --- Unknown forward-compatible field preservation ---------------------------

/**
 * Keys present in the stored config that the CURRENT schema does not declare.
 * These are forward-compatible fields a NEWER server wrote; the client echoes
 * them back verbatim so an older view never silently drops a newer field.
 */
export function collectUnknownFields(
  schema: ConfigSchemaDTO,
  current: Record<string, unknown>,
): Record<string, unknown> {
  const known = new Set(schema.fields.map((f) => f.key));
  const unknown: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(current)) if (!known.has(k)) unknown[k] = v;
  return unknown;
}

export interface ConfigPatch {
  /** Known edited/non-secret fields. */
  fields: Record<string, unknown>;
  /** Secrets that must be preserved (untouched): keys → type-of-preserve marker. */
  preserveSecrets: string[];
  /** Secrets the user explicitly cleared. */
  clearedSecrets: string[];
  /** Unknown forward-compatible fields echoed back verbatim. */
  unknownFields: Record<string, unknown>;
}

/**
 * Build the save payload the deferred write endpoint will accept. Pure shape —
 * there is NO write POST in this run; this is the client contract so the
 * eventual A-coordinated endpoint can consume exactly this patch.
 *
 * - untouched secrets → `preserveSecrets` (never the sentinel, never a value: it
 *   can only choose "keep prior", so the sentinel can not become a stored credential).
 * - edits merge over known non-secret fields.
 * - cleared secrets land in `clearedSecrets`.
 * - unknown fields are echoed back verbatim.
 */
export function buildConfigPatch(
  schema: ConfigSchemaDTO,
  current: Record<string, unknown>,
  edits: Record<string, unknown>,
  clearedKeys: readonly string[] = [],
): ConfigPatch {
  const patch: ConfigPatch = {
    fields: {},
    preserveSecrets: [],
    clearedSecrets: [],
    unknownFields: collectUnknownFields(schema, current),
  };
  const cleared = new Set(clearedKeys);
  for (const f of schema.fields) {
    const edited = Object.prototype.hasOwnProperty.call(edits, f.key);
    if (f.kind === "secret") {
      if (cleared.has(f.key)) patch.clearedSecrets.push(f.key);
      else if (edited) patch.fields[f.key] = edits[f.key];
      else patch.preserveSecrets.push(f.key);
    } else if (edited) {
      patch.fields[f.key] = edits[f.key];
    } else if (Object.prototype.hasOwnProperty.call(current, f.key)) {
      patch.fields[f.key] = current[f.key];
    }
  }
  return patch;
}