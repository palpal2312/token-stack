import test from "node:test";
import assert from "node:assert/strict";

import type { CapabilityRegistryDTO, ConfigSchemaDTO } from "../../src/lib/config/config-schema";
import {
  SECRET_SENTINEL_CLEARED,
  SECRET_SENTINEL_UNTOUCHED,
  collectUnknownFields,
  buildConfigPatch,
  renderSecretValue,
  secretState,
} from "../../src/lib/config/config-schema";
import {
  interpretFieldGate,
  interpretSchemaGates,
  type HostGates,
} from "../../src/lib/config/capability-registry";
import type { EffectiveConfigExplanationDTO } from "../../src/lib/config/settings-preview";
import {
  computeRestartWarnings,
  projectEffectivePreview,
  projectRollbackPreview,
  SOURCE_LABELS,
} from "../../src/lib/config/settings-preview";

// --- Fixtures ----------------------------------------------------------------

const REGISTRY: CapabilityRegistryDTO = {
  version: 1,
  digest: "sha256:abc",
  capabilities: [
    { id: "sandbox", present: true },
    { id: "terminal", present: true },
    { id: "notifications", present: false, reason: "Denied by workspace policy." },
    { id: "gpu", present: false },
  ],
};

const HOST_FULL: HostGates = {
  capabilities: ["terminal", "notifications", "native-dialogs", "sandbox"],
  permissions: ["code-space.run", "approvals.read", "settings.write"],
};

const SCHEMA: ConfigSchemaDTO = {
  schemaId: "workspace.runtime",
  version: 3,
  scope: "workspace",
  fields: [
    { key: "sandbox_mode", kind: "string", requiredCapability: "sandbox" },
    { key: "builder_token", kind: "secret", requiredPermission: "settings.write" },
    { key: "model_codex", kind: "computed", unsupportedReason: "Selected by the runtime profile." },
    { key: "experimental_streaming", kind: "experimental", unsupportedReason: "Experimental on this build.", impact: "security-downgrade" },
    { key: "cache_policy", kind: "choice", impact: "requires-restart" },
    { key: "resource_ceiling", kind: "number", impact: "requires-restart" },
  ],
};

// --- Interpretation (capability registry -> present/disabled-with-reason) ----

test("capability gate: present field when registry + host admit the capability", () => {
  const g = interpretFieldGate(SCHEMA.fields[0], REGISTRY, HOST_FULL);
  assert.equal(g.present, true);
  assert.equal(g.disabled, false);
});

test("capability gate: disabled with the registry's EXACT reason when present=false", () => {
  const needs = interpretFieldGate(
    { key: "x", kind: "string", requiredCapability: "notifications" },
    REGISTRY,
    HOST_FULL,
  );
  assert.equal(needs.disabled, true);
  assert.equal(needs.disableKind, "capability");
  assert.equal(needs.reason, "Denied by workspace policy."); // server, not a hard-coded label
});

test("capability gate: disabled when host lacks the capability even if registry present", () => {
  const g = interpretFieldGate(
    { key: "x", kind: "string", requiredCapability: "gpu" },
    { version: 1, digest: "d", capabilities: [{ id: "gpu", present: false }] },
    { capabilities: [], permissions: [] },
  );
  assert.equal(g.disabled, true);
  assert.equal(g.disableKind, "capability");
});

test("permission gate: disabled with permission reason when the host lacks it", () => {
  const g = interpretFieldGate(
    SCHEMA.fields[1], // builder_token requires settings.write
    REGISTRY,
    { capabilities: [], permissions: [] },
  );
  assert.equal(g.disabled, true);
  assert.equal(g.disableKind, "permission");
  assert.match(g.reason ?? "", /settings\.write/);
});

test("unsupported field: disabled with the schema's exact reason", () => {
  const g = interpretFieldGate(SCHEMA.fields[2], REGISTRY, HOST_FULL);
  assert.equal(g.disabled, true);
  assert.equal(g.disableKind, "unsupported");
  assert.equal(g.reason, "Selected by the runtime profile.");
});

test("interpretSchemaGates maps every field to a gate keyed by field key", () => {
  const gates = interpretSchemaGates(SCHEMA, REGISTRY, HOST_FULL);
  assert.equal(Object.keys(gates).length, SCHEMA.fields.length);
  assert.equal(gates.sandbox_mode.disabled, false);
  assert.equal(gates.model_codex.disableKind, "unsupported");
  assert.equal(gates.builder_token.disabled, false); // settings.write present in HOST_FULL
});

test("interpretSchemaGates never hard-codes the registry: empty host disables gated fields", () => {
  const gates = interpretSchemaGates(SCHEMA, REGISTRY, { capabilities: [], permissions: [] });
  assert.equal(gates.sandbox_mode.disabled, true);
  assert.equal(gates.builder_token.disabled, true);
  assert.equal(gates.cache_policy.disabled, false); // ungated field stays editable
});

// --- Sentinel tokens ---------------------------------------------------------

test("sentinel: secretState classifies untouched / cleared / not-secret", () => {
  assert.equal(secretState(SECRET_SENTINEL_UNTOUCHED), "untouched");
  assert.equal(secretState(SECRET_SENTINEL_CLEARED), "cleared");
  assert.equal(secretState("real-secret"), "not-secret");
  assert.equal(secretState(undefined), "not-secret");
});

test("sentinel: renderSecretValue masks untouched, blanks cleared, never leaks", () => {
  assert.equal(renderSecretValue("untouched"), "••••••");
  assert.equal(renderSecretValue("untouched").includes(SECRET_SENTINEL_UNTOUCHED), false);
  assert.equal(renderSecretValue("cleared"), " ");
  assert.equal(renderSecretValue("not-secret"), "");
});

// --- Unknown forward-compatible field preservation ---------------------------

test("unknown-field preservation: collectUnknownFields echoes newer keys verbatim", () => {
  const current = { retention_days: 45, quota_boost: { level: 2 }, execution_mode: "policy" };
  const unknown = collectUnknownFields(SCHEMA, current);
  // execution_mode is not a declared field of SCHEMA, so it is also forward-compatible.
  assert.deepEqual(unknown, { retention_days: 45, quota_boost: { level: 2 }, execution_mode: "policy" });
});

test("buildConfigPatch: untouched secret -> preserveSecrets, never sentinel or value", () => {
  const current = { builder_token: SECRET_SENTINEL_UNTOUCHED };
  const patch = buildConfigPatch(SCHEMA, current, {}, []);
  assert.ok(patch.preserveSecrets.includes("builder_token"));
  assert.ok(!Object.keys(patch.fields).includes("builder_token")); // never emitted for preserve
  assert.equal(patch.clearedSecrets.length, 0);
  assert.equal(patch.preserveSecrets[0]?.includes(SECRET_SENTINEL_UNTOUCHED), false);
});

test("buildConfigPatch: cleared secret -> clearedSecrets, not a stored value", () => {
  const patch = buildConfigPatch(SCHEMA, { builder_token: SECRET_SENTINEL_UNTOUCHED }, {}, ["builder_token"]);
  assert.deepEqual(patch.clearedSecrets, ["builder_token"]);
  assert.equal(patch.preserveSecrets.length, 0);
});

test("buildConfigPatch: unknown fields echoed back verbatim", () => {
  const current = { retention_days: 45, cache_policy: "conservative" };
  const patch = buildConfigPatch(SCHEMA, current, {});
  assert.deepEqual(patch.unknownFields, { retention_days: 45 });
  assert.equal(patch.fields.cache_policy, "conservative"); // known field carried
});

test("buildConfigPatch: edited known field merges over current", () => {
  const patch = buildConfigPatch(SCHEMA, { cache_policy: "conservative" }, { cache_policy: "aggressive" });
  assert.equal(patch.fields.cache_policy, "aggressive");
});

// --- Restart warning computation ---------------------------------------------

const EXPLANATION: EffectiveConfigExplanationDTO = {
  schemaId: "workspace.runtime",
  version: 3,
  requested: { cache_policy: "aggressive", resource_ceiling: 12 },
  effective: {
    execution_mode: "policy",
    cache_policy: "aggressive",
    resource_ceiling: 12,
    builder_token: SECRET_SENTINEL_UNTOUCHED,
    model_codex: "opus-current",
    experimental_streaming: false,
    retention_days: 45,
  },
  sourceByField: {
    execution_mode: "workspace",
    cache_policy: "workspace",
    resource_ceiling: "workspace",
    builder_token: "profile",
    model_codex: "profile",
    experimental_streaming: "view",
    retention_days: "workspace",
  },
  policyDecisions: [{ field: "resource_ceiling", reason: "Upper-bounded to 16 GB." }],
  warnings: ["Cache policy change applies after the next restart."],
  restartFields: ["cache_policy", "resource_ceiling"],
  requiresRestart: true,
  capabilityDigest: "sha256:def",
  priorVersion: {
    version: 2,
    effective: {
      execution_mode: "policy",
      cache_policy: "conservative",
      resource_ceiling: 16,
      builder_token: SECRET_SENTINEL_UNTOUCHED,
      model_codex: "opus-current",
      experimental_streaming: false,
    },
  },
};

test("restart warnings: requiresRestart + per-field restartFields + server warnings are unique", () => {
  const warnings = computeRestartWarnings(EXPLANATION);
  assert.ok(warnings.some((w) => w.includes("requires a restart")));
  assert.ok(warnings.some((w) => w.includes('"cache_policy"')));
  assert.ok(warnings.some((w) => w.includes('"resource_ceiling"')));
  assert.ok(warnings.includes("Cache policy change applies after the next restart."));
  assert.equal(new Set(warnings).size, warnings.length); // deduped
});

test("projectEffectivePreview: source labels, impacts, and per-field restart flags", () => {
  const proj = projectEffectivePreview(SCHEMA.fields, EXPLANATION);
  const cache = proj.rows.find((r) => r.key === "cache_policy")!;
  assert.equal(cache.sourceLabel, SOURCE_LABELS.workspace);
  assert.equal(cache.effect, "Requires a restart to take effect");
  assert.equal(cache.restart, true);
  assert.equal(proj.requiresRestart, true);
  const model = proj.rows.find((r) => r.key === "builder_token")!;
  assert.equal(model.sourceLabel, SOURCE_LABELS.profile);
  assert.equal(model.restart, false);
});

test("projectEffectivePreview: experimental field carries security-downgrade impact", () => {
  const proj = projectEffectivePreview(SCHEMA.fields, EXPLANATION);
  const r = proj.rows.find((row) => row.key === "experimental_streaming");
  assert.equal(r?.impact, "security-downgrade");
});

test("rollback preview: diffs prior-valid version, reports restart, null without prior", () => {
  const rb = projectRollbackPreview(EXPLANATION)!;
  assert.equal(rb.targetVersion, 2);
  // The forward-compatible field (retention_days) exists only in the current
  // version, so rolling back would drop it — it is honestly reported as changed.
  assert.deepEqual([...rb.changedFields].sort(), ["cache_policy", "resource_ceiling", "retention_days"]);
  const cache = rb.rows.find((r) => r.key === "cache_policy")!;
  assert.equal(cache.currentValue, "aggressive");
  assert.equal(cache.priorValue, "conservative");
  assert.equal(cache.restart, true);
  const dropped = rb.rows.find((r) => r.key === "retention_days")!;
  assert.equal(dropped.currentValue, 45);
  assert.equal(dropped.priorValue, undefined);

  const noPrior = projectRollbackPreview({ ...EXPLANATION, priorVersion: undefined });
  assert.equal(noPrior, null);
});