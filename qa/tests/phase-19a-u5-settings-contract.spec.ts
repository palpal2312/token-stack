// Phase 19a U5 — DETERMINISTIC CONTRACT HARNESS for the settings preview
// projection (`src/lib/config/settings-preview.ts`).
//
// This spec is the fixture-authoritative contract for the SHAPE the settings
// read path must hand the UI. The authorizing Go endpoint
// (`go/internal/http/sen/config.go`, PROPOSED) must emit an
// `EffectiveConfigExplanationDTO` and a preview projection that satisfy these
// EXACT assertions — same field keys, same layering source labels, same
// restart computation, same unknown-field passthrough, same sentinel masking:
//
//   1. DETERMINISM   — the same input must project to byte-identical output
//                      (stable row order, stable key sets). A non-deterministic
//                      Go response is a contract violation.
//   2. UNKNOWN FIELDS — keys the current schema does not declare (written by a
//                      NEWER server) MUST be preserved verbatim in the preview
//                      and rolled back honestly, never dropped by the consumer.
//   3. RESTART       — restart is computed from `requiresRestart` +
//                      `restartFields` + server `warnings`, deduped and
//                      attributed per field.
//   4. SENTINEL      — a stored secret MUST never surface as its real value:
//                      `projectEffectivePreview` carries the UNTOUCHED sentinel,
//                      and `renderSecretValue` masks it; a real token can never
//                      enter the preview.
//
// Run:  node --test --import tsx qa/tests/phase-19a-u5-settings-contract.spec.ts
import assert from "node:assert/strict";
import test from "node:test";

import {
  computeRestartWarnings,
  projectEffectivePreview,
  projectRollbackPreview,
  type EffectiveConfigExplanationDTO,
} from "../../src/lib/config/settings-preview";
import {
  SECRET_EDIT_MASK,
  SECRET_SENTINEL_UNTOUCHED,
  collectUnknownFields,
  renderSecretValue,
  secretState,
  type ConfigSchemaDTO,
} from "../../src/lib/config/config-schema";

// The consumer-shaped snapshot the Go endpoint must reproduce (shape-wise).
// `retention_days` is a forward-compatible field a NEWER server wrote.
const SCHEMA_FIELDS = [
  { key: "execution_mode", impact: "future-attempts-only", kind: "choice" },
  { key: "cache_policy", impact: "requires-restart", kind: "choice" },
  { key: "resource_ceiling", impact: "requires-restart", kind: "number" },
  { key: "builder_token", kind: "secret" },
  { key: "experimental_streaming", impact: "security-downgrade", kind: "experimental" },
] as const;

const SCHEMA: ConfigSchemaDTO = {
  schemaId: "workspace.runtime",
  version: 3,
  scope: "workspace",
  fields: SCHEMA_FIELDS,
};

const EXPLANATION: EffectiveConfigExplanationDTO = {
  schemaId: "workspace.runtime",
  version: 3,
  requested: { cache_policy: "aggressive", resource_ceiling: 12 },
  effective: {
    execution_mode: "policy",
    cache_policy: "aggressive",
    resource_ceiling: 12,
    sandbox_mode: "nested",
    builder_token: SECRET_SENTINEL_UNTOUCHED,
    model_codex: "opus-current",
    experimental_streaming: false,
    retention_days: 45, // forward-compatible, unknown to this schema version
  },
  sourceByField: {
    execution_mode: "workspace",
    cache_policy: "workspace",
    resource_ceiling: "workspace",
    sandbox_mode: "install",
    builder_token: "profile",
    model_codex: "profile",
    experimental_streaming: "view",
    retention_days: "workspace",
  },
  policyDecisions: [{ field: "resource_ceiling", reason: "Upper-bounded to 16 GB by workspace policy." }],
  warnings: ["Cache policy change applies after the next restart."],
  restartFields: ["cache_policy", "resource_ceiling"],
  requiresRestart: true,
  capabilityDigest: "sha256:def0123456789abcdefedcba9876543210fedcba987654321",
  priorVersion: {
    version: 2,
    effective: {
      execution_mode: "policy",
      cache_policy: "conservative",
      resource_ceiling: 16,
      sandbox_mode: "nested",
      builder_token: SECRET_SENTINEL_UNTOUCHED,
      model_codex: "opus-current",
      experimental_streaming: false,
    },
  },
};

// --- 1. Determinism ---------------------------------------------------------
test("contract: the projection is deterministic — identical input -> identical output", () => {
  const a = projectEffectivePreview(SCHEMA_FIELDS, EXPLANATION);
  const b = projectEffectivePreview(SCHEMA_FIELDS, EXPLANATION);
  assert.deepEqual(b, a, "two runs of the pure projection must be identical");
  // Row order is stable and sorted by key — the Go endpoint must emit the same
  // canonical order so diffs are stable across servers.
  const keys = a.rows.map((r) => r.key);
  assert.deepEqual(keys, [...keys].sort(), "rows are canonically sorted by key");
});

test("contract: warning set is deterministic and deduped", () => {
  const w = computeRestartWarnings(EXPLANATION);
  const w2 = computeRestartWarnings(EXPLANATION);
  assert.deepEqual(w, w2);
  assert.equal(new Set(w).size, w.length, "restart warnings must not duplicate");
});

// --- 2. Unknown forward-compatible preservation -----------------------------
test('contract: unknown field "retention_days" survives into the preview', () => {
  const proj = projectEffectivePreview(SCHEMA_FIELDS, EXPLANATION);
  const row = proj.rows.find((r) => r.key === "retention_days");
  assert.ok(row, "forward-compatible field must appear in the preview rows");
  assert.equal(row.effectiveValue, 45, "value preserved verbatim");
  assert.equal(row.sourceLabel, "Workspace config");
});

test("contract: unknown-field collector echoes newer keys verbatim", () => {
  const current = { retention_days: 45, quota_boost: { level: 2 }, execution_mode: "policy" };
  assert.deepEqual(collectUnknownFields(SCHEMA, current), {
    retention_days: 45,
    quota_boost: { level: 2 }, // execution_mode IS declared by SCHEMA, so it is known, not unknown
  });
});

test("contract: rollback honestly reports unknown field as dropped (current-only)", () => {
  const rb = projectRollbackPreview(EXPLANATION);
  assert.ok(rb);
  assert.deepEqual([...rb.changedFields].sort(), ["cache_policy", "resource_ceiling", "retention_days"]);
  const dropped = rb.rows.find((r) => r.key === "retention_days");
  assert.equal(dropped?.currentValue, 45);
  assert.equal(dropped?.priorValue, undefined);
});

// --- 3. Restart computation -------------------------------------------------
test("contract: requiresRestart + per-field restartFields + server warnings combine", () => {
  const proj = projectEffectivePreview(SCHEMA_FIELDS, EXPLANATION);
  assert.equal(proj.requiresRestart, true);
  assert.deepEqual([...proj.restartFields], ["cache_policy", "resource_ceiling"]);
  assert.equal(proj.rows.find((r) => r.key === "cache_policy")?.restart, true);
  assert.equal(proj.rows.find((r) => r.key === "resource_ceiling")?.restart, true);
  assert.equal(proj.rows.find((r) => r.key === "builder_token")?.restart, false);
  assert.ok(proj.warnings.includes("Saving these changes requires a restart to take effect."));
  assert.ok(proj.warnings.includes('Restart required to apply "resource_ceiling".'));
  assert.ok(proj.warnings.includes("Cache policy change applies after the next restart."));
});

test("contract: impact labels are stable for the Go endpoint to re-emit", () => {
  const proj = projectEffectivePreview(SCHEMA_FIELDS, EXPLANATION);
  assert.equal(proj.rows.find((r) => r.key === "execution_mode")?.effect, "Applies to future attempts only");
  assert.equal(proj.rows.find((r) => r.key === "cache_policy")?.effect, "Requires a restart to take effect");
  assert.equal(proj.rows.find((r) => r.key === "experimental_streaming")?.impact, "security-downgrade");
});

// --- 4. Sentinel masking ----------------------------------------------------
test("contract: a stored secret never surfaces as a real value in the preview", () => {
  const proj = projectEffectivePreview(SCHEMA_FIELDS, EXPLANATION);
  const row = proj.rows.find((r) => r.key === "builder_token");
  assert.equal(row?.effectiveValue, SECRET_SENTINEL_UNTOUCHED);
  const state = secretState(row?.effectiveValue);
  assert.equal(state, "untouched");
  const masked = renderSecretValue(state);
  assert.equal(masked, SECRET_EDIT_MASK, "the rendered secret is the masked sentinel, not the value");
  assert.ok(!masked.includes("news:secret"), "the control token must never be rendered");
});