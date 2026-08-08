// Turning a Builder profile into the three things a spawn needs: which binary,
// which args go in front, and which env vars give the child its identity.
//
// Everything the rest of the app does with a Builder goes through builderSpawn().
// Keeping it in one place is what makes "same binary, different account" reliable
// — and it is the only place raw API keys are read out of the registry.

import { existsSync } from "node:fs";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { cliSpec, defaultBinFor } from "./clis";
import type { CliSpec } from "./clis";
import { getBuilder } from "./registry";
import type { Builder } from "./registry";
import type { BuilderOverrides } from "../runner";

/**
 * Env names a profile may not set.
 *
 * A Builder's job is to choose an account, not to change how the process loads
 * code. These control the loader, the search path, or the home directory the CLI
 * derives everything else from — setting them turns a profile into arbitrary code
 * execution, and silently breaks the isolation the rest of this module provides.
 */
const BLOCKED_ENV = new Set([
  "PATH", "NODE_OPTIONS", "HOME", "USERPROFILE", "SHELL", "COMSPEC",
  "LD_PRELOAD", "LD_LIBRARY_PATH", "DYLD_INSERT_LIBRARIES",
  "NODE_PATH", "PYTHONPATH", "PATHEXT",
]);

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface EnvRejection { name: string; reason: string }

/** Filter user-supplied env down to what is safe to pass through. */
export function sanitizeEnv(input: Record<string, string>): { env: Record<string, string>; rejected: EnvRejection[] } {
  const env: Record<string, string> = {};
  const rejected: EnvRejection[] = [];
  for (const [rawName, rawValue] of Object.entries(input ?? {})) {
    const name = rawName.trim();
    if (!ENV_NAME.test(name)) { rejected.push({ name: rawName, reason: "not a valid environment variable name" }); continue; }
    if (BLOCKED_ENV.has(name.toUpperCase())) {
      rejected.push({ name, reason: "controls how the process loads code or where its home is — a profile picks an account, not a loader" });
      continue;
    }
    const value = String(rawValue ?? "");
    if (value.includes("\0")) { rejected.push({ name, reason: "contains a null byte" }); continue; }
    env[name] = value;
  }
  return { env, rejected };
}

export interface BuilderSpawn extends BuilderOverrides {
  builder: Builder;
  spec: CliSpec;
  extraEnv: Record<string, string>;
  model: string | null;
  effort: string | null;
  /** Non-fatal notes worth showing in the UI (rejected env, unverified isolation). */
  warnings: string[];
}

export class BuilderSpawnError extends Error {}

export function isPinnedQaFixture(builder: Builder): boolean {
  if (process.env.AGENTIC_OS_ALLOW_TEST_FIXTURE !== "1") return false;
  if (!builder.bin || builder.args.length !== 1) return false;
  if (path.resolve(builder.bin) !== path.resolve(process.execPath)) return false;
  const script = path.resolve(builder.args[0]);
  const scriptName = path.basename(script);
  const parentDir = path.basename(path.dirname(script));
  const grandParentDir = path.basename(path.dirname(path.dirname(script)));

  // Accept both echo-cli.cjs and quota-fail-cli.cjs from qa/fixtures/
  if (parentDir !== "fixtures" || grandParentDir !== "qa") return false;
  if (scriptName !== "echo-cli.cjs" && scriptName !== "quota-fail-cli.cjs") return false;

  // Both fixtures can use any CLI value for protocol testing.
  // The critical safety checks are:
  // 1. AGENTIC_OS_ALLOW_TEST_FIXTURE=1 (only set in QA environment)
  // 2. bin is exactly process.execPath (can't point at arbitrary binaries)
  // 3. script is from qa/fixtures/ directory
  return true;
}

export function assertBuilderExecutionCapability(builder: Builder, spec: CliSpec): void {
  if (isPinnedQaFixture(builder)) return;
  if (spec.capability?.governedExecution) return;
  if (spec.capability?.unsupportedReason) {
    throw new BuilderSpawnError(
      `${spec.label} cannot run through Builder-native LLMOps: ${spec.capability.unsupportedReason} `
      + "Choose a CLI/profile with proven governed execution capability.",
    );
  }
}

/**
 * Resolve a Builder into spawn inputs. Throws with a plain-language reason when
 * the profile cannot run — a bad binary path is far better caught here than as
 * an ENOENT four layers down.
 */
export function resolveBuilderSpawn(builder: Builder): BuilderSpawn {
  const spec = cliSpec(builder.cli);
  if (!spec) throw new BuilderSpawnError(`"${builder.name}" points at an unknown CLI (${builder.cli}).`);
  assertBuilderExecutionCapability(builder, spec);

  const warnings: string[] = [];
  const bin = builder.bin ?? defaultBinFor(spec);
  if (!bin) {
    throw new BuilderSpawnError(
      `${spec.label} has no binary configured. Set this profile's binary to the full path of the executable`
      + (process.platform === "win32" ? " (a .exe — Node cannot run .cmd or .ps1 shims)." : ".")
    );
  }
  if (!existsSync(bin)) {
    throw new BuilderSpawnError(`${spec.label}'s binary is not at ${bin}. Fix the path on this profile.`);
  }
  if (process.platform === "win32" && /\.(cmd|bat|ps1)$/i.test(bin)) {
    throw new BuilderSpawnError(
      `${bin} is a shim script, and Node cannot spawn one on Windows. Point this profile at the real .exe.`
    );
  }

  // Identity, in precedence order: isolation dir, then the profile's API keys,
  // then its free-form env. Each later layer may override the earlier one.
  const extraEnv: Record<string, string> = {};

  if (builder.auth.kind === "oauth" && builder.auth.configDir) {
    if (!spec.isolationEnv) {
      warnings.push(
        `${spec.label} has no verified way to separate logins, so this profile shares the CLI's default account.`
      );
    } else {
      mkdirSync(builder.auth.configDir, { recursive: true });
      extraEnv[spec.isolationEnv] = builder.auth.configDir;
    }
  }

  if (builder.auth.kind === "api") {
    const secrets = sanitizeEnv(builder.auth.env ?? {});
    for (const r of secrets.rejected) warnings.push(`Ignored credential ${r.name}: ${r.reason}.`);
    for (const [k, v] of Object.entries(secrets.env)) {
      if (!v.trim()) {
        // An empty key is worse than none: the CLI sees it as "use API auth",
        // fails, and the user's working OAuth login appears to have broken.
        throw new BuilderSpawnError(`${builder.name}'s ${k} is empty. Remove it or paste a real key.`);
      }
      extraEnv[k] = v;
    }
    // An API-key profile must not also inherit a login session, or which one wins
    // depends on the CLI's internal precedence rather than on what the user chose.
    if (spec.isolationEnv && builder.auth.configDir) extraEnv[spec.isolationEnv] = builder.auth.configDir;
  }

  const fixtureSession = isPinnedQaFixture(builder) && builder.env?.FIXTURE_SESSION === "1";
  const freeInput = { ...(builder.env ?? {}) };
  delete freeInput.FIXTURE_SESSION;
  const free = sanitizeEnv(freeInput);
  for (const r of free.rejected) warnings.push(`Ignored env ${r.name}: ${r.reason}.`);
  Object.assign(extraEnv, free.env);
  if (fixtureSession) extraEnv.FIXTURE_SESSION = "1";

  return {
    builder, spec,
    binOverride: bin,
    argsPrefix: builder.args,
    extraEnv,
    model: builder.model,
    effort: builder.effort ?? null,
    warnings,
  };
}

/** Look up a profile by id and resolve it. */
export async function builderSpawn(id: string): Promise<BuilderSpawn> {
  const b = await getBuilder(id);
  if (!b) throw new BuilderSpawnError(`No Builder profile "${id}".`);
  return resolveBuilderSpawn(b);
}

/** The default profile for a CLI, or null when none exists. */
export async function defaultBuilderFor(cli: string): Promise<Builder | null> {
  const { listBuilders } = await import("./registry");
  const all = await listBuilders();
  const forCli = all.filter((b) => b.cli === cli);
  return forCli.find((b) => b.isDefault) ?? forCli[0] ?? null;
}

export interface ChatSpawnOptions {
  binOverride?: string | null;
  argsPrefix?: readonly string[];
  extraEnv?: Record<string, string>;
  model?: string | null;
}

/**
 * What an existing chat route needs to honour an optional `builderId`.
 *
 * With no builderId the result is empty, so the tab spawns exactly as it did
 * before Builders existed — picking a profile has to be a deliberate act, or
 * seeding a registry would quietly change which account every tab talks to.
 *
 * Throws BuilderSpawnError when a profile was named but cannot run; the caller
 * should surface that rather than silently falling back to a different account.
 */
export async function chatSpawnOptions(builderId: unknown, expectedCli: string): Promise<ChatSpawnOptions> {
  if (typeof builderId !== "string" || !builderId.trim()) return {};
  const resolved = await builderSpawn(builderId.trim());
  if (resolved.builder.cli !== expectedCli && resolved.spec.binOf !== expectedCli) {
    throw new BuilderSpawnError(
      `"${resolved.builder.name}" is a ${resolved.spec.label} profile and cannot run in the ${expectedCli} tab.`,
    );
  }
  return {
    binOverride: resolved.binOverride,
    argsPrefix: resolved.argsPrefix,
    extraEnv: resolved.extraEnv,
    model: resolved.model,
  };
}
