"use client";

/**
 * Phase 19a U5 — schema-driven settings sections (read/local-presentation).
 *
 * Renders a server-provided `ConfigSnapshotDTO` (config schema + capability
 * registry + current values + section grouping) into schema-driven sections:
 * - unsupported/experimental/computed controls are disabled with the EXACT
 *   reason from the schema or registry (never a hard-coded UI label set);
 * - capability/permission-gated controls are disabled with their reason;
 * - masked secrets show the sentinel and distinguish untouched from cleared;
 * - unknown forward-compatible fields are echoed back verbatim (the client
 *   never drops a field a newer server wrote);
 * - the dry-run/preview (effective-config source/effect/restart warnings) and
 *   the rollback-to-prior-version preview render via `EffectiveConfigPreview`.
 *
 * There is NO write POST — save is the deferred A-coordinated endpoint; this
 * surface prepares the exact patch shape (`buildConfigPatch`).
 */
import { useMemo, useState } from "react";
import {
  collectUnknownFields,
  renderSecretValue,
  secretState,
} from "@/lib/config/config-schema";
import type { ConfigSnapshotDTO } from "@/lib/config/config-schema";
import { interpretSchemaGates } from "@/lib/config/capability-registry";
import type { HostGates } from "@/lib/config/capability-registry";
import type { EffectiveConfigExplanationDTO } from "@/lib/config/settings-preview";
import EffectiveConfigPreview from "./effective-config-preview";

export interface SettingsSnapshotInput extends ConfigSnapshotDTO {
  /** The read/preview explanation the server produced (projection input). */
  explanation: EffectiveConfigExplanationDTO;
}

export default function SchemaSettingsView({
  snapshot,
  host = { capabilities: [], permissions: [] },
}: {
  snapshot: SettingsSnapshotInput;
  host?: HostGates;
}) {
  const gates = useMemo(
    () => interpretSchemaGates(snapshot.schema, snapshot.capabilities, host),
    [snapshot.schema, snapshot.capabilities, host],
  );
  const unknownFields = useMemo(
    () => collectUnknownFields(snapshot.schema, snapshot.current),
    [snapshot.schema, snapshot.current],
  );

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-lg font-semibold text-neutral-100">Settings</h2>
        <p className="text-xs text-neutral-500">
          Schema {snapshot.schema.schemaId} v{snapshot.schema.version} · capability registry v{snapshot.capabilities.version} · digest {snapshot.capabilities.digest.slice(0, 12)}…
        </p>
      </header>

      <section aria-label="Settings sections" className="space-y-6">
        {snapshot.sections.map((section) => (
          <fieldset key={section.token} disabled className="rounded-lg border border-neutral-800/70 px-4 py-3">
            <legend className="px-1 text-sm font-medium text-neutral-200">{section.label}</legend>
            <div className="space-y-2">
              {snapshot.schema.fields
                .filter((f) => snapshot.current[f.key] !== undefined || f.defaultValue !== undefined)
                .map((field) => <FieldControl key={field.key} field={field} gate={gates[field.key]} value={snapshot.current[field.key]} />)}
            </div>
          </fieldset>
        ))}
      </section>

      {Object.keys(unknownFields).length > 0 && (
        <section aria-label="Unknown forward-compatible fields" className="rounded-lg border border-neutral-700/50 px-4 py-3">
          <h3 className="text-sm font-medium text-neutral-300 mb-2">Forward-compatible fields (preserved)</h3>
          <p className="text-xs text-neutral-500 mb-2">Written by a newer server version; echoed back verbatim on save — never dropped.</p>
          <ul className="space-y-1 font-mono text-xs text-neutral-400">
            {Object.entries(unknownFields).map(([k, v]) => (
              <li key={k}><span className="text-neutral-300">{k}</span> = {JSON.stringify(v)}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-lg border border-neutral-800/70 px-4 py-3">
        <h3 className="text-sm font-medium text-neutral-300 mb-2">Dry-run / preview before save</h3>
        <EffectiveConfigPreview schema={snapshot.schema} explanation={snapshot.explanation} />
      </section>
    </div>
  );
}

function FieldControl({
  field,
  gate,
  value,
}: {
  field: { key: string; label?: string; kind: string; requiredPermission?: string; requiredCapability?: string; unsupportedReason?: string };
  gate: { present: boolean; disabled: boolean; reason?: string } | undefined;
  value: unknown;
}) {
  const label = field.label ?? field.key;
  const disabled = !gate?.present || gate.disabled;
  const reason = gate?.disabled ? gate.reason : undefined;
  const isSecret = field.kind === "secret";
  const state = isSecret ? secretState(value) : "not-secret";

  return (
    <div className="py-2">
      <div className="flex items-center gap-2">
        <span className="text-sm text-neutral-200">{label}</span>
        {field.kind === "experimental" && (
          <span className="rounded border border-violet-400/40 bg-violet-400/10 px-1 text-[10px] uppercase text-violet-300/90">experimental</span>
        )}
        {field.kind === "unsupported" && (
          <span className="rounded border border-neutral-600/50 bg-neutral-600/10 px-1 text-[10px] uppercase text-neutral-400">unsupported</span>
        )}
      </div>

      {isSecret ? (
        <div className="mt-1">
          <input
            type="password"
            value={renderSecretValue(state)}
            readOnly
            disabled={disabled}
            className="w-full max-w-sm rounded border border-neutral-700 bg-neutral-900/60 px-2 py-1 text-sm text-neutral-300 disabled:opacity-50"
          />
          <p className="mt-0.5 text-[11px] text-neutral-500">
            {state === "untouched" && "Present — value is not transmitted; preserved as-is on save."}
            {state === "cleared" && "Explicitly cleared."}
            {reason && <span className="text-neutral-400"> · {reason}</span>}
          </p>
        </div>
      ) : (
        <div className="mt-1">
          <input
            value={renderPlain(value)}
            readOnly
            disabled={disabled}
            aria-disabled={disabled}
            className="w-full max-w-sm rounded border border-neutral-700 bg-neutral-900/60 px-2 py-1 text-sm text-neutral-300 disabled:opacity-50"
          />
          {reason && <p className="mt-0.5 text-[11px] text-neutral-400">{reason}</p>}
        </div>
      )}
    </div>
  );
}

function renderPlain(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}