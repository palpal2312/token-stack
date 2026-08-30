/**
 * Phase 19a U5 — pure consumption of a server-provided `EffectiveConfigExplanationDTO`.
 *
 * This is the read/preview + local-presentation slice: it projects the
 * effective-config source/effect/restart warnings and the rollback-to-prior
 * preview. There is NO write endpoint here (the deferred A-coordinated part).
 * Pure and side-effect free — the projection is unit-testable under
 * `node --test --import tsx` and rendered by
 * `src/features/settings/effective-config-preview.tsx`.
 */
import type { ConfigImpact } from "./config-schema";

/** Config layering layers (Phase 19a "Configuration layering", steps 1-6). */
export type ConfigSource =
  | "install"    // step 1: install/build public defaults
  | "workspace"  // step 2: workspace canonical config
  | "profile"    // step 3: builder/runtime profile config
  | "override"   // step 4: task-approved override
  | "attempt"    // step 5: attempt snapshot (immutable effective)
  | "view"       // step 6: user view preferences (never steps 2-5)

export const SOURCE_LABELS: Record<ConfigSource, string> = {
  install: "Install default",
  workspace: "Workspace config",
  profile: "Runtime profile",
  override: "Task-approved override",
  attempt: "Attempt snapshot",
  view: "View preference",
};

export const IMPACT_LABELS: Record<ConfigImpact, string> = {
  "future-attempts-only": "Applies to future attempts only",
  "requires-restart": "Requires a restart to take effect",
  "blocked-running-attempts": "Blocked while an attempt is running",
  "security-downgrade": "Security downgrade — extra review after save",
};

export interface EffectiveConfigExplanationDTO {
  schemaId: string;
  version: number;
  /** The typed request the browser submitted/views (secrets carry sentinels). */
  requested: Record<string, unknown>;
  /** The resolved effective config, per the layering rules above. */
  effective: Record<string, unknown>;
  /** field key → layering source that dominated resolution. */
  sourceByField: Record<string, string>;
  /** policy decisions (clamped/bounded/replaced) with the exact reason. */
  policyDecisions: readonly { field: string; reason: string }[];
  warnings: readonly string[];
  /** Often the schema's own field impact aggregated by Go. */
  restartFields: readonly string[];
  requiresRestart: boolean;
  capabilityDigest: string;
  /** Prior VALID version's effective values for the rollback preview. */
  priorVersion?: { version: number; effective: Record<string, unknown> };
}

export interface FieldSourceRow {
  key: string;
  source: ConfigSource;
  sourceLabel: string;
  effectiveValue: unknown;
  /** The impact kind when the field's change has one (drives the badge color). */
  impact?: ConfigImpact;
  /** Human "effect" line when the field's change has an impact. */
  effect?: string;
  /** True when this specific field's change triggers the restart requirement. */
  restart: boolean;
}

export interface EffectivePreviewProjection {
  rows: readonly FieldSourceRow[];
  requiresRestart: boolean;
  restartFields: readonly string[];
  warnings: readonly string[];
}

/** Resolve a field's impact to a human effect line. */
export function impactLabel(impact?: ConfigImpact): string | undefined {
  return impact ? IMPACT_LABELS[impact] : undefined;
}

/**
 * Compute the restart warnings for an explanation. Data-driven:
 * - the whole save requires restart when `explanation.requiresRestart` is true;
 * - a field requires restart when its key is in `restartFields`;
 * - warnings from the server (`warnings`) pass through verbatim.
 * Returns unique, human-readable lines the preview renders.
 */
export function computeRestartWarnings(
  explanation: EffectiveConfigExplanationDTO,
): string[] {
  const warnings = new Set<string>(explanation.warnings);
  if (explanation.requiresRestart) {
    warnings.add("Saving these changes requires a restart to take effect.");
  }
  for (const key of explanation.restartFields) {
    warnings.add(`Restart required to apply "${key}".`);
  }
  return [...warnings];
}

/**
 * Project an explanation for the dry-run/preview surface: one row per effective
 * field with its layering source, human effect, and per-field restart flag.
 * Notes which fields actually differ from the typed request (delta indicator).
 */
export function projectEffectivePreview(
  schemaFields: readonly { key: string; impact?: ConfigImpact }[],
  explanation: EffectiveConfigExplanationDTO,
): EffectivePreviewProjection {
  const impactByKey = new Map(schemaFields.map((f) => [f.key, f.impact]));
  const restartSet = new Set(explanation.restartFields);
  const rows: FieldSourceRow[] = [];
  for (const key of Object.keys(explanation.effective)) {
    const source = (explanation.sourceByField[key] as ConfigSource | undefined) ?? "view";
    const impact = impactByKey.get(key);
    rows.push({
      key,
      source,
      sourceLabel: SOURCE_LABELS[source] ?? source,
      effectiveValue: explanation.effective[key],
      impact,
      effect: impact ? impactLabel(impact) : undefined,
      // Per-row restart reflects only the fields the server flagged for restart;
      // the aggregate requiresRestart flag drives the banner warning separately.
      restart: restartSet.has(key),
    });
  }
  rows.sort((a, b) => a.key.localeCompare(b.key));
  return {
    rows,
    requiresRestart: explanation.requiresRestart,
    restartFields: explanation.restartFields,
    warnings: computeRestartWarnings(explanation),
  };
}

export interface RollbackFieldRow {
  key: string;
  currentValue: unknown;
  priorValue: unknown;
  restart: boolean;
}

export interface RollbackPreviewProjection {
  /** Target (prior VALID) version number — never a downgrade below the newest supported base. */
  targetVersion: number;
  rows: readonly RollbackFieldRow[];
  /** Fields that differ from the current effective config. */
  changedFields: readonly string[];
  requiresRestart: boolean;
  warnings: readonly string[];
}

/**
 * Preview what rolling back to the PRIOR valid version changes — a new audited
 * version derived from the previous valid value (never a history rewrite). Pure
 * projection; the rolled-back write itself is the deferred A-coordinated part.
 */
export function projectRollbackPreview(
  explanation: EffectiveConfigExplanationDTO,
): RollbackPreviewProjection | null {
  const prior = explanation.priorVersion;
  if (!prior) return null;
  const priorEffective = prior.effective;
  const keys = new Set<string>([...Object.keys(explanation.effective), ...Object.keys(priorEffective)]);
  const rows: RollbackFieldRow[] = [];
  const changedFields: string[] = [];
  const restartSet = new Set(explanation.restartFields);
  for (const key of keys) {
    const currentValue = explanation.effective[key];
    const priorValue = priorEffective[key];
    const changed = !Object.is(currentValue, priorValue);
    if (changed) changedFields.push(key);
    rows.push({ key, currentValue, priorValue, restart: restartSet.has(key) });
  }
  rows.sort((a, b) => a.key.localeCompare(b.key));
  const affectsRestart = Object.keys(explanation.effective).some((k) => restartSet.has(k) && changedFields.includes(k));
  return {
    targetVersion: prior.version,
    rows,
    changedFields,
    requiresRestart: affectsRestart || explanation.requiresRestart,
    warnings: computeRestartWarnings(explanation),
  };
}