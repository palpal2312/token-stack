// Strict Builder execution projection (PX lane, SO0F).
//
// The Go control plane must never consume `/api/builders` or raw
// `builders.json`: those carry secrets (`auth.env`), raw `env`, notes, config
// paths and arbitrary `cli + args` fallbacks. This module produces the ONLY
// allowed execution contract — an allowlisted DTO with just enough non-secret
// identity for PB to verify and launch one exact Builder:
//
//   - Builder ID + display label
//   - exact verified wrapper token (omitted when no wrapper file exists —
//     an unverified/fallback launcher blocks R2, never falls back to args)
//   - immutable revision + non-secret fingerprint (deterministic hashes)
//   - capability provenance (catalog CliSpec, non-secret)
//   - identity/safety provenance (auth kind, key NAMES only, timestamps)
//   - CLI version/fingerprint (version only when already observed; never
//     spawned here — a read projection has no business starting processes)
//   - observation time
//
// Never emitted: raw env, auth.env, key/token values, config/home paths,
// previews, notes, arbitrary args, fallback cli + args, raw Builder JSON.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { cliSpec, defaultBinFor } from "./clis";
import type { Builder } from "./registry";

export const EXECUTION_PROJECTION_REVISION = 1;

export interface BuilderExecutionDTO {
  builderId: string;
  displayLabel: string;
  /** Exact token the OS resolves (npm-global wrapper `<id>.cmd|.ps1`).
   * Absent when no verified wrapper exists — PB must treat that as blocking. */
  wrapperToken?: string;
  /** sha256 over the canonical identity inputs; changes iff execution-relevant
   * config changes. Deterministic and non-secret. */
  revision: string;
  /** sha256 over the execution identity (wrapper/cli/bin-path-string). */
  fingerprint: string;
  capability: {
    cli: string;
    protocol: string | null;
    governedExecution: boolean;
    nativeActivityTelemetry: boolean;
    preExecutionTools: "proven" | "unsupported" | "unknown";
    authKinds: string[];
    multiProfile: boolean;
  };
  provenance: {
    authKind: string;
    /** True when a credential dir exists; the path itself is never emitted. */
    hasIsolatedConfig: boolean;
    /** Env/isolation variable NAMES only — values never leave this process. */
    envKeyNames: string[];
    apiKeyEnvName: string | null;
    isolationEnvName: string | null;
    verifiedAt: string | null;
  };
  cliVersion: string | null;
  cliFingerprint: string;
  observedAt: string;
}

/** Exact-token charset, mirrored by the Go decoder: a lowercase slug only.
 * An id outside it can never be a verified wrapper, even if a file matches. */
const WRAPPER_TOKEN_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Same wrapper rule as registry.resolveLaunchCmd, exported for tests. */
export function wrapperExistsFor(builderId: string, platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== "win32") return false;
  if (!WRAPPER_TOKEN_PATTERN.test(builderId)) return false;
  const npmBin = path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "npm");
  return existsSync(path.join(npmBin, `${builderId}.ps1`)) || existsSync(path.join(npmBin, `${builderId}.cmd`));
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Canonical JSON: sorted keys, so the hash is stable across property order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export interface ProjectOptions {
  /** Injectable for hermetic tests; defaults to the real npm-bin probe. */
  wrapperExists?: (builderId: string) => boolean;
  observedAt?: string;
}

/**
 * Project one raw Builder into the strict execution DTO. Reads only the
 * allowlisted inputs; secret-bearing fields (`auth.env`, `env` values,
 * `notes`, `args` for launch, `auth.configDir`) are consumed nowhere and
 * echoed nowhere — including in errors (this function does not throw on
 * secret content; it simply never reads values).
 */
export function projectBuilderExecution(b: Builder, opts: ProjectOptions = {}): BuilderExecutionDTO {
  const wrapperExists = opts.wrapperExists ?? wrapperExistsFor;
  const observedAt = opts.observedAt ?? new Date().toISOString();
  const spec = cliSpec(b.cli);
  const binResolved = b.bin ?? (spec ? defaultBinFor(spec) : null);

  const hasWrapper = wrapperExists(b.id) && WRAPPER_TOKEN_PATTERN.test(b.id);

  const revision = sha256Hex(canonical({
    v: EXECUTION_PROJECTION_REVISION,
    id: b.id,
    cli: b.cli,
    bin: b.bin,
    model: b.model,
    effort: b.effort ?? null,
    authKind: b.auth.kind,
    envKeys: Object.keys(b.env ?? {}).sort(),
    authEnvKeys: Object.keys(b.auth.env ?? {}).sort(),
    hasConfigDir: Boolean(b.auth.configDir),
  }));

  const fingerprint = sha256Hex(canonical({
    wrapper: hasWrapper ? b.id : null,
    cli: b.cli,
    binResolved,
  }));

  const cliFingerprint = sha256Hex(canonical({
    cli: b.cli,
    binResolved,
    versionArgs: spec?.versionArgs ?? [],
  }));

  return {
    builderId: b.id,
    displayLabel: b.name,
    ...(hasWrapper ? { wrapperToken: b.id } : {}),
    revision,
    fingerprint,
    capability: {
      cli: b.cli,
      protocol: spec?.protocol ?? null,
      governedExecution: spec?.capability?.governedExecution ?? false,
      nativeActivityTelemetry: spec?.capability?.nativeActivityTelemetry ?? false,
      preExecutionTools: spec?.capability
        ? (spec.capability.preExecutionTools.status === "proven" ? "proven" : "unsupported")
        : "unknown",
      authKinds: spec ? [...spec.authKinds] : [],
      multiProfile: spec?.multiProfile ?? false,
    },
    provenance: {
      authKind: b.auth.kind,
      hasIsolatedConfig: Boolean(b.auth.configDir),
      envKeyNames: [...Object.keys(b.env ?? {}), ...Object.keys(b.auth.env ?? {})].sort(),
      apiKeyEnvName: spec?.apiKeyEnv ?? null,
      isolationEnvName: spec?.isolationEnv ?? null,
      verifiedAt: b.verifiedAt ?? null,
    },
    cliVersion: null, // live version capture stays with the health probe
    cliFingerprint,
    observedAt,
  };
}

export function projectBuildersExecution(builders: Builder[], opts: ProjectOptions = {}): BuilderExecutionDTO[] {
  return builders.map((b) => projectBuilderExecution(b, opts));
}
