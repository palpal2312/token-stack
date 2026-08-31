/**
 * Phase 19a U5 — UI interpretation of server-provided capability DTOs.
 *
 * The CAPABILITY REGISTRY IS DATA, never a hard-coded UI guess (Phase 19a
 * "Configuration layering", rule: "CapabilityRegistry is data returned by Go,
 * not a hard-coded UI guess"). This module maps a server-provided
 * `CapabilityRegistryDTO` + the host's capability/permission set onto each
 * config field's present/disabled-with-reason state. It contains NO registry
 * of which capabilities exist — it reads the DTO records and the published
 * schema fields.
 *
 * Pure and side-effect free — unit-testable under `node --test --import tsx`.
 */
import type {
  CapabilityRegistryDTO,
  ConfigFieldSchema,
  ConfigSchemaDTO,
} from "./config-schema";

/** Why a field is disabled; drives the exact reason shown on the control. */
export type FieldDisableKind = "capability" | "permission" | "unsupported";

export interface FieldGateState {
  /** Whether the control is present for the current host. */
  present: boolean;
  /** Whether the control must be disabled (present but not editable). */
  disabled: boolean;
  /** Exact server-provided reason when disabled — never a hard-coded label. */
  reason?: string;
  /** Which gate produced the disabled reason. */
  disableKind?: FieldDisableKind;
}

/** Host capability/permission set supplied by the platform adapter. */
export interface HostGates {
  readonly capabilities: readonly string[];
  readonly permissions: readonly string[];
}

const registryPresent = (
  registry: CapabilityRegistryDTO,
  id: string,
): { present: boolean; reason?: string } => {
  const entry = registry.capabilities.find((c) => c.id === id);
  if (!entry) return { present: false, reason: `capability '${id}' is not in the registry` };
  return { present: entry.present, reason: entry.reason };
};

/**
 * Resolve one field's editable gate. Order matters:
 * 1. capability gate (host + registry) → disabled-with-reason if unmet;
 * 2. permission gate           → disabled-with-reason if unmet;
 * 3. unsupported/experimental/computed (schema `unsupportedReason`) → disabled.
 * The exact reason always comes from server data (`registry.reason` or the
 * schema's `unsupportedReason`), never from a client-side label set.
 */
export function interpretFieldGate(
  field: ConfigFieldSchema,
  registry: CapabilityRegistryDTO,
  host: HostGates,
): FieldGateState {
  if (field.requiredCapability) {
    const reg = registryPresent(registry, field.requiredCapability);
    if (!host.capabilities.includes(field.requiredCapability)) {
      return { present: false, disabled: true, reason: reg.reason ?? `host lacks capability '${field.requiredCapability}'`, disableKind: "capability" };
    }
    if (!reg.present) {
      return { present: true, disabled: true, reason: reg.reason ?? `capability '${field.requiredCapability}' is not configured`, disableKind: "capability" };
    }
  }
  if (field.requiredPermission && !host.permissions.includes(field.requiredPermission)) {
    return { present: true, disabled: true, reason: `permission '${field.requiredPermission}' is required`, disableKind: "permission" };
  }
  if (
    (field.kind === "unsupported" || field.kind === "experimental" || field.kind === "computed") &&
    field.unsupportedReason
  ) {
    return { present: true, disabled: true, reason: field.unsupportedReason, disableKind: "unsupported" };
  }
  return { present: true, disabled: false };
}

/**
 * Resolve every field of a schema to its present/disabled-with-reason gate.
 * The result is KEYED data, mapped purely from the DTOs — no hard-coded
 * capability registry.
 */
export function interpretSchemaGates(
  schema: ConfigSchemaDTO,
  registry: CapabilityRegistryDTO,
  host: HostGates,
): Record<string, FieldGateState> {
  const out: Record<string, FieldGateState> = {};
  for (const f of schema.fields) out[f.key] = interpretFieldGate(f, registry, host);
  return out;
}