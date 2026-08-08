// Builder profiles, stored in ~/.agentic-os/builders.json.
//
// The file lives outside source/ so an Agent OS update never deletes your
// accounts, and it holds API keys, so three rules shape everything here:
//
//   1. Writes are atomic and serialized. Several route handlers can be mid-flight
//      at once; a plain read-modify-write loses edits, and a torn write loses the
//      whole file. Every write goes through one promise chain and lands via
//      temp-file + rename.
//   2. Corrupted is not the same as absent. An unreadable file is reported and
//      left exactly as it is. Only a genuinely missing file may be seeded — one
//      hand-edit typo must never cost you your keys.
//   3. Secrets never leave here in the clear. Callers that answer HTTP use
//      publicBuilder(); the raw value is for spawning only.

import { readFile, writeFile, rename, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { allClis, cliSpec, defaultBinFor } from "./clis";
import type { AuthKind } from "./clis";

export const AGENTIC_HOME = process.env.AGENTIC_OS_HOME ?? path.join(os.homedir(), ".agentic-os");
export const BUILDERS_FILE = path.join(AGENTIC_HOME, "builders.json");
export const PROFILES_ROOT = path.join(AGENTIC_HOME, "builders");

export interface BuilderAuth {
  kind: AuthKind;
  /** oauth: the CLI's config/credential dir for this profile. */
  configDir?: string;
  /** api: secret env vars, e.g. { ANTHROPIC_API_KEY: "sk-..." }. */
  env?: Record<string, string>;
}

export interface Builder {
  id: string;
  cli: string;
  name: string;
  auth: BuilderAuth;
  env: Record<string, string>;
  bin: string | null;
  args: string[];
  model: string | null;
  /** Reasoning effort override (e.g. "low"|"medium"|"high"), passed to CLIs
   * that have a verified flag for it (codex). Others record it but omit the
   * flag — same contract as firstmate's own effort rule. */
  effort?: string | null;
  isDefault: boolean;
  notes: string;
  createdAt: string;
  /**
   * Set when the last health probe proved the profile works AND its account is
   * connected. Cleared when a probe proves the opposite. Absent/unverified
   * probes leave it untouched — agents reading /api/builders should treat this
   * as "last known good at <time>", never as a live guarantee.
   */
  verifiedAt?: string;
  /** What the passing probe saw, e.g. "Provider sakana: accepted · Weekly 15%". */
  verifiedDetail?: string;
  /**
   * Last quota reading persisted by the health probe, with its timestamp.
   * Displayed by default and readable via GET /api/builders so an agent can
   * compare profiles (and, later, switch away when one is exhausted). Stale
   * data is normal — check checkedAt before trusting it.
   */
  quota?: { text: string; checkedAt: string };
}

interface RegistryFile { version: 1; builders: Builder[] }

/** Thrown when the file exists but cannot be understood. Never auto-repaired. */
export class RegistryCorrupt extends Error {
  constructor(public readonly file: string, cause: unknown) {
    super(`${file} could not be read as JSON (${String(cause)}). It has been left untouched — `
      + `fix or move the file; Agent OS will not overwrite it, because it may hold your API keys.`);
    this.name = "RegistryCorrupt";
  }
}

// ---------------------------------------------------------------- persistence

/** Serializes every write. Reads are cheap and re-read the file, so no cache to invalidate. */
let writeChain: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeChain.then(fn, fn);
  // Keep the chain alive regardless of individual failures.
  writeChain = next.then(() => undefined, () => undefined);
  return next;
}

async function readFileRaw(): Promise<RegistryFile | null> {
  if (!existsSync(BUILDERS_FILE)) return null;
  let text: string;
  try { text = await readFile(BUILDERS_FILE, "utf8"); }
  catch (e) { throw new RegistryCorrupt(BUILDERS_FILE, e); }
  if (!text.trim()) return { version: 1, builders: [] };
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch (e) { throw new RegistryCorrupt(BUILDERS_FILE, e); }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as RegistryFile).builders)) {
    throw new RegistryCorrupt(BUILDERS_FILE, "no builders array");
  }
  return { version: 1, builders: (parsed as RegistryFile).builders.map(normalize) };
}

function normalize(b: Partial<Builder>): Builder {
  return {
    id: String(b.id ?? ""),
    cli: String(b.cli ?? ""),
    name: String(b.name ?? b.id ?? ""),
    auth: {
      kind: (b.auth?.kind ?? "none") as AuthKind,
      configDir: b.auth?.configDir,
      env: b.auth?.env && typeof b.auth.env === "object" ? { ...b.auth.env } : undefined,
    },
    env: b.env && typeof b.env === "object" ? { ...b.env } : {},
    bin: b.bin ?? null,
    args: Array.isArray(b.args) ? b.args.map(String) : [],
    model: b.model ?? null,
    // Optional field: absent stays absent, so pre-feature files round-trip unchanged.
    ...(b.effort !== undefined ? { effort: b.effort } : {}),
    isDefault: Boolean(b.isDefault),
    notes: String(b.notes ?? ""),
    createdAt: String(b.createdAt ?? new Date().toISOString()),
    verifiedAt: b.verifiedAt ? String(b.verifiedAt) : undefined,
    verifiedDetail: b.verifiedDetail ? String(b.verifiedDetail) : undefined,
    quota: b.quota && typeof b.quota.text === "string"
      ? { text: String(b.quota.text).slice(0, 300), checkedAt: String(b.quota.checkedAt ?? "") }
      : undefined,
  };
}

async function writeAtomic(data: RegistryFile): Promise<void> {
  await mkdir(AGENTIC_HOME, { recursive: true });
  // A unique temp name so two writers can never share one temp file.
  const tmp = `${BUILDERS_FILE}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  await rename(tmp, BUILDERS_FILE);           // atomic on the same volume
}

// -------------------------------------------------------------------- seeding

/**
 * First run only: give every installed CLI one profile wrapping its current
 * setup, so existing tabs keep working with no manual step. Guarded by a single
 * module-level promise — a cold start fires many concurrent requests, and each
 * of them seeing "no file" must not mean each of them seeds.
 */
let seedOnce: Promise<void> | null = null;

async function seedIfAbsent(): Promise<void> {
  if (existsSync(BUILDERS_FILE)) return;
  seedOnce ??= serialized(async () => {
    if (existsSync(BUILDERS_FILE)) return;     // re-check inside the lock
    const builders: Builder[] = [];
    for (const spec of allClis()) {
      if (spec.id.startsWith("fixture")) continue; // no default binary by design
      const bin = defaultBinFor(spec);
      if (!bin || !existsSync(bin)) continue;  // only seed what is actually here
      builders.push(normalize({
        id: `${spec.id}-default`,
        cli: spec.id,
        name: `${spec.label} — default`,
        auth: { kind: "none" },                // uses the CLI's existing login as-is
        isDefault: true,
        notes: "Created automatically from your existing setup. Its identity is whatever the CLI "
          + "is already logged in as; add another profile to run a second account.",
        createdAt: new Date().toISOString(),
      }));
    }
    await writeAtomic({ version: 1, builders });
  });
  await seedOnce;
}

// ------------------------------------------------------------------ public API

export async function listBuilders(): Promise<Builder[]> {
  await seedIfAbsent();
  const f = await readFileRaw();
  return f?.builders ?? [];
}

export async function getBuilder(id: string): Promise<Builder | null> {
  return (await listBuilders()).find((b) => b.id === id) ?? null;
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
}

export interface CreateInput {
  cli: string;
  name: string;
  authKind?: AuthKind;
  secrets?: Record<string, string>;
  env?: Record<string, string>;
  bin?: string | null;
  args?: string[];
  model?: string | null;
  effort?: string | null;
  notes?: string;
}

export async function createBuilder(input: CreateInput): Promise<Builder> {
  const spec = cliSpec(input.cli);
  if (!spec) throw new Error(`Unknown CLI "${input.cli}".`);
  const name = String(input.name ?? "").trim();
  if (!name) throw new Error("Give the profile a name.");

  const kind: AuthKind = input.authKind ?? "none";
  if (!spec.authKinds.includes(kind)) {
    throw new Error(`${spec.label} does not support ${kind} auth (supported: ${spec.authKinds.join(", ")}).`);
  }
  if (kind === "api") {
    const vals = Object.values(input.secrets ?? {}).filter((v) => v && v.trim());
    if (!vals.length) throw new Error("An API-key profile needs a key. An empty key is worse than none — "
      + "it overrides the CLI's own login and breaks it.");
  }

  return serialized(async () => {
    const f = (await readFileRaw()) ?? { version: 1 as const, builders: [] };
    const base = slugify(name) || spec.id;
    let id = base;
    for (let n = 2; f.builders.some((b) => b.id === id); n++) id = `${base}-${n}`;

    const auth: BuilderAuth = { kind };
    if (kind === "oauth") {
      if (!spec.isolationEnv) {
        throw new Error(`${spec.label} has no verified way to keep a second account separate, so a `
          + `login profile would silently share the existing one. Use the default profile instead.`);
      }
      auth.configDir = path.join(PROFILES_ROOT, id);
      await mkdir(auth.configDir, { recursive: true });
    } else if (kind === "api") {
      auth.env = { ...input.secrets };
    }

    const builder = normalize({
      id, cli: spec.id, name, auth,
      env: input.env ?? {},
      bin: input.bin ?? null,
      args: input.args ?? [],
      model: input.model ?? null,
      effort: input.effort ?? null,
      isDefault: !f.builders.some((b) => b.cli === spec.id),
      notes: input.notes ?? "",
      createdAt: new Date().toISOString(),
    });
    f.builders.push(builder);
    await writeAtomic(f);
    return builder;
  });
}

/**
 * Import a CLI-native profile (see lib/builders/nativeProfiles.ts) as a Builder.
 *
 * Auth is always "none" and that is not a shortcut: a native profile lives in
 * the CLI's *default* home by construction (`codex -p` layers a file inside
 * $CODEX_HOME), so it shares the default login — the same contract the seeded
 * defaults carry. Going through createBuilder would reject "none" for codex,
 * whose authKinds assume an Agent OS-made profile.
 */
export async function createNativeImport(input: {
  cli: string; profileName: string; args: string[]; source: string;
  provider?: { name: string; envKey: string | null; baseUrl: string | null };
}): Promise<Builder> {
  const spec = cliSpec(input.cli);
  if (!spec) throw new Error(`Unknown CLI "${input.cli}".`);

  return serialized(async () => {
    const f = (await readFileRaw()) ?? { version: 1 as const, builders: [] };
    const sameArgs = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);
    if (f.builders.some((b) => b.cli === spec.id && sameArgs(b.args, input.args))) {
      throw new NativeImportExists(`A Builder already runs ${spec.label} ${input.args.join(" ")}.`);
    }

    const base = `${spec.id}-${slugify(input.profileName) || "profile"}`;
    let id = base;
    for (let n = 2; f.builders.some((b) => b.id === id); n++) id = `${base}-${n}`;

    const notes = input.provider
      ? `Imported from the CLI's own profile "${input.profileName}" (${input.source}). `
        + `It routes to the "${input.provider.name}" provider${input.provider.envKey ? ` (key from ${input.provider.envKey})` : ""} — `
        + "the default login does not apply to this profile."
      : `Imported from the CLI's own profile "${input.profileName}" (${input.source}). `
        + "It shares the CLI's default login, because the native profile lives in the default home.";

    const builder = normalize({
      id,
      cli: spec.id,
      name: `${spec.label} — ${input.profileName}`,
      auth: { kind: "none" },
      env: {},
      bin: null,
      args: input.args,
      model: null,
      isDefault: !f.builders.some((b) => b.cli === spec.id),
      notes,
      createdAt: new Date().toISOString(),
    });
    f.builders.push(builder);
    await writeAtomic(f);
    return builder;
  });
}

export class NativeImportExists extends Error {}

export interface PatchInput {
  name?: string;
  /** Only the keys present are changed. `null` clears one. Absent = untouched. */
  secrets?: Record<string, string | null>;
  env?: Record<string, string>;
  bin?: string | null;
  args?: string[];
  model?: string | null;
  effort?: string | null;
  isDefault?: boolean;
  notes?: string;
  /** `null` deletes the stored quota reading (e.g. one recorded against the
   *  wrong account). Absent = untouched. */
  quota?: null;
}

export async function updateBuilder(id: string, patch: PatchInput): Promise<Builder> {
  return serialized(async () => {
    const f = await readFileRaw();
    const b = f?.builders.find((x) => x.id === id);
    if (!f || !b) throw new Error(`No profile "${id}".`);
    const invalidatesVerification = patch.secrets !== undefined
      || patch.env !== undefined
      || patch.bin !== undefined
      || patch.args !== undefined;

    if (patch.name !== undefined) {
      const n = String(patch.name).trim();
      if (!n) throw new Error("The profile needs a name.");
      b.name = n;
    }
    if (patch.secrets) {
      const env = { ...(b.auth.env ?? {}) };
      for (const [k, v] of Object.entries(patch.secrets)) {
        if (v === null) { delete env[k]; continue; }
        // The UI only ever shows a masked value. If one comes back, the user did
        // not retype the key — writing it would replace a working key with "sk-…1234".
        if (isMasked(v)) continue;
        if (!v.trim()) throw new Error(`${k} cannot be blank — remove it instead.`);
        env[k] = v;
      }
      b.auth.env = env;
      if (b.auth.kind === "api" && !Object.keys(env).length) {
        throw new Error("An API-key profile must keep at least one key.");
      }
    }
    if (patch.env !== undefined) b.env = { ...patch.env };
    if (patch.bin !== undefined) b.bin = patch.bin;
    if (patch.args !== undefined) b.args = patch.args.map(String);
    if (patch.model !== undefined) b.model = patch.model;
    if (patch.effort !== undefined) b.effort = patch.effort;
    if (patch.notes !== undefined) b.notes = String(patch.notes);
    if (patch.quota === null) delete b.quota;
    if (patch.isDefault) {
      for (const o of f.builders) if (o.cli === b.cli) o.isDefault = o.id === b.id;
    }
    if (invalidatesVerification) {
      delete b.verifiedAt;
      delete b.verifiedDetail;
    }
    await writeAtomic(f);
    return b;
  });
}

/**
 * Record the outcome of a health probe on the builder itself. `verified` marks
 * the last known-good check; `null` clears it when a probe proves the profile
 * broken. This is the flag agents (First Mate) read from GET /api/builders to
 * know which profiles are safe to use without re-probing.
 */
export async function setBuilderVerified(id: string, verified: { at: string; detail: string } | null): Promise<void> {
  return serialized(async () => {
    const f = await readFileRaw();
    const b = f?.builders.find((x) => x.id === id);
    if (!f || !b) return;
    if (verified) {
      b.verifiedAt = verified.at;
      b.verifiedDetail = verified.detail.slice(0, 300);
    } else {
      delete b.verifiedAt;
      delete b.verifiedDetail;
    }
    await writeAtomic(f);
  });
}

/** Persist the latest quota reading (never cleared — always dated). */
export async function setBuilderQuota(id: string, text: string): Promise<void> {
  return serialized(async () => {
    const f = await readFileRaw();
    const b = f?.builders.find((x) => x.id === id);
    if (!f || !b) return;
    b.quota = { text: text.slice(0, 300), checkedAt: new Date().toISOString() };
    await writeAtomic(f);
  });
}

export async function deleteBuilder(id: string, opts: { purge?: boolean } = {}): Promise<{ removedDir: string | null }> {  return serialized(async () => {
    const f = await readFileRaw();
    const b = f?.builders.find((x) => x.id === id);
    if (!f || !b) throw new Error(`No profile "${id}".`);
    f.builders = f.builders.filter((x) => x.id !== id);
    // Keep a default per CLI so tabs still resolve one.
    if (b.isDefault) {
      const sibling = f.builders.find((x) => x.cli === b.cli);
      if (sibling) sibling.isDefault = true;
    }
    await writeAtomic(f);

    // The credential directory is deliberately NOT deleted by default: it holds a
    // real logged-in session, and removing the registry row is reversible while
    // destroying the login is not. Purging is an explicit, separate decision.
    let removedDir: string | null = null;
    if (opts.purge && b.auth.configDir && b.auth.configDir.startsWith(PROFILES_ROOT)) {
      const { rm } = await import("node:fs/promises");
      await rm(b.auth.configDir, { recursive: true, force: true });
      removedDir = b.auth.configDir;
    }
    return { removedDir };
  });
}

/** Credential directories with no profile pointing at them. */
export async function orphanedProfileDirs(): Promise<string[]> {
  if (!existsSync(PROFILES_ROOT)) return [];
  const known = new Set((await listBuilders()).map((b) => b.auth.configDir).filter(Boolean));
  const entries = await readdir(PROFILES_ROOT, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory())
    .map((e) => path.join(PROFILES_ROOT, e.name))
    .filter((p) => !known.has(p));
}

// -------------------------------------------------------------------- masking

const MASK_MIDDLE = "…";     // the ellipsis marks a value as display-only

export function maskSecret(v: string): string {
  if (!v) return "";
  if (v.length <= 8) return `${v.slice(0, 2)}${MASK_MIDDLE}`;
  return `${v.slice(0, 4)}${MASK_MIDDLE}${v.slice(-4)}`;
}

export function isMasked(v: string): boolean { return v.includes(MASK_MIDDLE); }

export interface PublicBuilder extends Omit<Builder, "auth"> {
  auth: { kind: AuthKind; configDir?: string; secretKeys: string[]; secretPreview: Record<string, string> };
  binResolved: string | null;
  /** The shortest command a user can type in a terminal to launch this profile. */
  launchCmd: string;
}

/**
 * Resolve the shortest command to launch a builder.
 * Priority: wrapper script in npm global bin > cli + args > cli name only.
 */
function resolveLaunchCmd(b: Builder): string {
  // 1. Check for wrapper script matching builder ID in npm global bin
  const npmBin = process.platform === "win32"
    ? path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "npm")
    : null; // Unix: could check $(npm bin -g) but wrappers are a Windows pattern here
  if (npmBin) {
    const hasWrapper = existsSync(path.join(npmBin, `${b.id}.ps1`))
      || existsSync(path.join(npmBin, `${b.id}.cmd`));
    if (hasWrapper) return b.id;
  }

  // 2. Fallback: cli name + args
  const cliName = b.cli === "antigravity" ? "agy" : b.cli;
  if (b.args.length > 0) return [cliName, ...b.args].join(" ");
  return cliName;
}

/** The shape safe to send over HTTP: keys masked, never raw. */
export function publicBuilder(b: Builder): PublicBuilder {
  const spec = cliSpec(b.cli);
  const secrets = b.auth.env ?? {};
  return {
    ...b,
    auth: {
      kind: b.auth.kind,
      configDir: b.auth.configDir,
      secretKeys: Object.keys(secrets),
      secretPreview: Object.fromEntries(Object.entries(secrets).map(([k, v]) => [k, maskSecret(v)])),
    },
    binResolved: b.bin ?? (spec ? defaultBinFor(spec) : null),
    launchCmd: resolveLaunchCmd(b),
  };
}

