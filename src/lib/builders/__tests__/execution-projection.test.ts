import assert from "node:assert/strict";
import test from "node:test";
import {
  projectBuilderExecution,
  projectBuildersExecution,
  wrapperExistsFor,
  EXECUTION_PROJECTION_REVISION,
} from "../execution-projection";
import type { Builder } from "../registry";

const SECRET_VALUE = "sk-super-secret-test-value-1234567890";
const CONFIG_PATH = "C:\\Users\\tester\\.agentic-os\\builders\\secret-profile";

function secretBearingBuilder(): Builder {
  return {
    id: "claude-kimi",
    cli: "claude",
    name: "Claude via Kimi",
    auth: { kind: "api", configDir: CONFIG_PATH, env: { ANTHROPIC_API_KEY: SECRET_VALUE } },
    env: { ANTHROPIC_BASE_URL: "https://proxy.example.invalid", CUSTOM_FLAG: "1" },
    bin: null,
    args: ["--dangerous-flag", "raw fragment; rm -rf"],
    model: "kimi-k2",
    effort: "high",
    isDefault: true,
    notes: "personal notes with PII and the key again " + SECRET_VALUE,
    createdAt: "2026-08-17T00:00:00.000Z",
    verifiedAt: "2026-08-17T01:00:00.000Z",
    verifiedDetail: "Provider sakana: accepted · Weekly 15%",
    quota: { text: "Weekly 15%", checkedAt: "2026-08-17T01:00:00.000Z" },
  };
}

test("secret-bearing Builder: DTO leaks no secret value, config path, notes, args or raw env", () => {
  const dto = projectBuilderExecution(secretBearingBuilder(), {
    wrapperExists: () => true,
    observedAt: "2026-08-18T00:00:00.000Z",
  });
  const wire = JSON.stringify(dto);

  assert.ok(!wire.includes(SECRET_VALUE), "secret value leaked into DTO");
  assert.ok(!wire.includes(CONFIG_PATH), "config path leaked into DTO");
  assert.ok(!wire.includes("personal notes"), "notes leaked into DTO");
  assert.ok(!wire.includes("dangerous-flag"), "raw args leaked into DTO");
  assert.ok(!wire.includes("proxy.example.invalid"), "raw env value leaked into DTO");
  assert.ok(!wire.includes("sakana"), "verifiedDetail preview leaked into DTO");
  assert.ok(!wire.includes("quota"), "quota leaked into DTO");

  // Key NAMES are allowed; values are not.
  assert.deepEqual(dto.provenance.envKeyNames, ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "CUSTOM_FLAG"]);
  assert.equal(dto.provenance.authKind, "api");
  assert.equal(dto.provenance.hasIsolatedConfig, true);
});

test("exact allowlist: no extra fields beyond the frozen DTO shape", () => {
  const dto = projectBuilderExecution(secretBearingBuilder(), { wrapperExists: () => true });
  assert.deepEqual(Object.keys(dto).sort(), [
    "builderId", "capability", "cliFingerprint", "cliVersion", "displayLabel",
    "fingerprint", "observedAt", "provenance", "revision", "wrapperToken",
  ]);
  assert.deepEqual(Object.keys(dto.capability).sort(), [
    "authKinds", "cli", "governedExecution", "multiProfile",
    "nativeActivityTelemetry", "preExecutionTools", "protocol",
  ]);
  assert.deepEqual(Object.keys(dto.provenance).sort(), [
    "apiKeyEnvName", "authKind", "envKeyNames", "hasIsolatedConfig",
    "isolationEnvName", "verifiedAt",
  ]);
});

test("verified wrapper emits exact token; unverified wrapper is omitted (blocks R2, never falls back)", () => {
  const withWrapper = projectBuilderExecution(secretBearingBuilder(), { wrapperExists: () => true });
  assert.equal(withWrapper.wrapperToken, "claude-kimi");

  const without = projectBuilderExecution(secretBearingBuilder(), { wrapperExists: () => false });
  assert.equal("wrapperToken" in without, false);
  // No fallback cli+args field may appear anywhere.
  assert.ok(!JSON.stringify(without).includes("claude --"), "fallback cli+args leaked");
  assert.notEqual(withWrapper.fingerprint, without.fingerprint, "wrapper presence must change fingerprint");
});

test("revision is deterministic and changes only with execution-relevant identity", () => {
  const base = secretBearingBuilder();
  const opts = { wrapperExists: () => true, observedAt: "2026-08-18T00:00:00.000Z" };
  const a = projectBuilderExecution(base, opts);
  const b = projectBuilderExecution({ ...base }, opts);
  assert.equal(a.revision, b.revision, "same inputs must hash identically");
  assert.equal(a.observedAt, b.observedAt);

  // Non-execution fields (notes, quota, verified detail) must not move revision.
  const cosmetic = projectBuilderExecution({ ...base, notes: "different notes", quota: undefined }, opts);
  assert.equal(a.revision, cosmetic.revision);

  // Execution-relevant changes move the revision.
  const rebinned = projectBuilderExecution({ ...base, bin: "C:\\tools\\claude.exe" }, opts);
  assert.notEqual(a.revision, rebinned.revision);
  const newSecretKey = projectBuilderExecution(
    { ...base, auth: { ...base.auth, env: { OTHER_KEY: "x" } } }, opts);
  assert.notEqual(a.revision, newSecretKey.revision, "auth env key set is identity-relevant");
});

test("unknown CLI still projects fail-soft with explicit unknowns, never throws", () => {
  const odd = { ...secretBearingBuilder(), id: "mystery", cli: "not-a-real-cli" };
  const dto = projectBuilderExecution(odd, { wrapperExists: () => false });
  assert.equal(dto.capability.protocol, null);
  assert.equal(dto.capability.preExecutionTools, "unknown");
  assert.equal(dto.capability.governedExecution, false);
  assert.equal(dto.cliVersion, null);
  assert.ok(dto.revision.length === 64 && dto.fingerprint.length === 64);
});

test("observation time is stamped; batch projection covers every builder", () => {
  const list = [secretBearingBuilder(), { ...secretBearingBuilder(), id: "second", name: "Second" }];
  const dtos = projectBuildersExecution(list, { wrapperExists: () => false, observedAt: "2026-08-18T02:00:00.000Z" });
  assert.equal(dtos.length, 2);
  assert.ok(dtos.every((d) => d.observedAt === "2026-08-18T02:00:00.000Z"));
  assert.ok(typeof EXECUTION_PROJECTION_REVISION === "number");
});

test("wrapper rule is Windows-only, matching the registry's launchCmd pattern", () => {
  // On non-Windows hosts there is no npm-global wrapper convention here, so
  // no wrapperToken can ever be verified — R2 stays blocked there by design.
  assert.equal(wrapperExistsFor("claude-kimi", "linux"), false);
  assert.equal(wrapperExistsFor("claude-kimi", "darwin"), false);
});

test("non-slug builder id can never emit a wrapper token, even with a matching file", () => {
  const evil = { ...secretBearingBuilder(), id: "..\\evil" };
  const dto = projectBuilderExecution(evil, { wrapperExists: () => true });
  assert.equal("wrapperToken" in dto, false, "path-like id must not become a wrapper token");
});

test("projection revision is pinned at 1 until a contract bump", () => {
  assert.equal(EXECUTION_PROJECTION_REVISION, 1);
});
