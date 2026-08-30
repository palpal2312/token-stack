"use client";

/**
 * Phase 19a U5 — source/effect/restart preview before save (read-only).
 *
 * Consumes a server-provided `EffectiveConfigExplanationDTO` and projects the
 * effective config's layering source, human effect, restart warnings, and the
 * rollback-to-prior-version preview. Pure projection lives in
 * `src/lib/config/settings-preview.ts`; this component only renders it.
 * There is NO write/update POST here — the deferred A-coordinated part.
 */
import type { ConfigImpact } from "@/lib/config/config-schema";
import type { ConfigFieldSchema } from "@/lib/config/config-schema";
import type { EffectiveConfigExplanationDTO } from "@/lib/config/settings-preview";
import {
  projectEffectivePreview,
  projectRollbackPreview,
  SOURCE_LABELS,
} from "@/lib/config/settings-preview";
import { renderSecretValue, secretState } from "@/lib/config/config-schema";

const IMPACT_BADGE: Record<ConfigImpact, string> = {
  "future-attempts-only": "text-sky-300/90 border-sky-400/40 bg-sky-400/10",
  "requires-restart": "text-amber-300/90 border-amber-400/40 bg-amber-400/10",
  "blocked-running-attempts": "text-orange-300/90 border-orange-400/40 bg-orange-400/10",
  "security-downgrade": "text-rose-300/90 border-rose-400/40 bg-rose-400/10",
};

function stringify(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "object") return JSON.stringify(v);
  if (typeof v === "string") {
    // A stored secret MUST never render as its raw control token: the sentinel
    // ("this secret exists but its value is not transmitted") is masked here so
    // no rendered preview/rollback cell can leak it.
    const state = secretState(v);
    if (state !== "not-secret") return renderSecretValue(state);
    return v || "—";
  }
  return String(v);
}

export default function EffectiveConfigPreview({
  schema,
  explanation,
}: {
  schema: { fields: readonly ConfigFieldSchema[] };
  explanation: EffectiveConfigExplanationDTO;
}) {
  const projection = projectEffectivePreview(schema.fields, explanation);
  const rollback = projectRollbackPreview(explanation);

  return (
    <div className="space-y-6">
      <section aria-label="Effective configuration">
        <h3 className="text-sm font-medium text-neutral-300 mb-2">Effective configuration</h3>
        {projection.warnings.length > 0 && (
          <ul className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 mb-3 space-y-1">
            {projection.warnings.map((w) => (
              <li key={w} className="text-xs text-amber-200/90">{w}</li>
            ))}
          </ul>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-neutral-500">
                <th className="py-2 pr-4">Field</th>
                <th className="py-2 pr-4">Source</th>
                <th className="py-2 pr-4">Effective value</th>
                <th className="py-2 pr-4">Effect</th>
                <th className="py-2">Restart</th>
              </tr>
            </thead>
            <tbody>
              {projection.rows.map((row) => (
                <tr key={row.key} className="border-t border-neutral-800/70">
                  <td className="py-2 pr-4 font-mono text-xs text-neutral-200">{row.key}</td>
                  <td className="py-2 pr-4 text-xs text-neutral-400">{row.sourceLabel}</td>
                  <td className="py-2 pr-4 font-mono text-xs text-neutral-300">{stringify(row.effectiveValue)}</td>
                  <td className="py-2 pr-4">
                    {row.effect ? (
                      <span
                        className={`inline-block rounded border px-1.5 py-0.5 text-xs ${row.impact ? IMPACT_BADGE[row.impact] : "text-neutral-400 border-neutral-600/50 bg-neutral-600/10"}`}
                      >
                        {row.effect}
                      </span>
                    ) : (
                      <span className="text-xs text-neutral-600">—</span>
                    )}
                  </td>
                  <td className="py-2 text-xs">{row.restart ? <span className="text-amber-300/90">yes</span> : <span className="text-neutral-600">no</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {rollback && (
        <section aria-label="Rollback to prior version">
          <h3 className="text-sm font-medium text-neutral-300 mb-2">
            Rollback preview — prior valid version {rollback.targetVersion}
          </h3>
          {rollback.changedFields.length === 0 ? (
            <p className="text-xs text-neutral-500">The prior valid version matches the current effective configuration.</p>
          ) : (
            <div className="space-y-2">
              {rollback.warnings.length > 0 && (
                <ul className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 space-y-1">
                  {rollback.warnings.map((w) => (
                    <li key={w} className="text-xs text-amber-200/90">{w}</li>
                  ))}
                </ul>
              )}
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-neutral-500">
                    <th className="py-2 pr-4">Field</th>
                    <th className="py-2 pr-4">Current</th>
                    <th className="py-2 pr-4">Prior (v{rollback.targetVersion})</th>
                    <th className="py-2">Restart</th>
                  </tr>
                </thead>
                <tbody>
                  {rollback.rows.filter((r) => rollback.changedFields.includes(r.key)).map((row) => (
                    <tr key={row.key} className="border-t border-neutral-800/70">
                      <td className="py-2 pr-4 font-mono text-xs text-neutral-200">{row.key}</td>
                      <td className="py-2 pr-4 font-mono text-xs text-neutral-300">{stringify(row.currentValue)}</td>
                      <td className="py-2 pr-4 font-mono text-xs text-neutral-300">{stringify(row.priorValue)}</td>
                      <td className="py-2 text-xs">{row.restart ? <span className="text-amber-300/90">yes</span> : <span className="text-neutral-600">no</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

export { SOURCE_LABELS };