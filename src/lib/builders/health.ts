// Health probe for a Builder profile.
//
// Two questions, answered separately because they are proven differently:
//
//   state       "will this profile run, and does it have an identity of its
//               own?" — from running the binary and looking for a credential.
//   connection  "is the account behind this profile actually connected?" —
//               only reported where a free proof exists:
//               - CLIs with a verified auth-status command (`claude auth
//                 status`, `codex login status`) answer connected/not-connected
//                 per profile, because those commands honour the isolation env.
//               - API-key profiles are probed against the provider's free
//                 endpoint (*/models, or OpenRouter's /key, which also returns
//                 usage/limit).
//               - Kimi exposes quotas only in its TUI, so the probe drives that
//                 TUI through a PTY and parses the /usage panel (weekly + 5h
//                 plan limits); the panel answering proves the login too.
//               - Everything else stays "unverified" rather than guessing.
//
// "ok"/"connected" is still not a promise about tomorrow — tokens expire —
// but connection: not-connected is a hard signal the profile will not work.

import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { agentEnv } from "../runner";
import { resolveBuilderSpawn, BuilderSpawnError } from "./spawn";
import { detectNativeProfiles } from "./nativeProfiles";
import type { Builder } from "./registry";

export type HealthState = "ok" | "auth-unverified" | "fail";
export type Connection = "connected" | "not-connected" | "unverified";

export interface BuilderHealth {
  state: HealthState;
  /** One sentence a user can act on. */
  message: string;
  version: string | null;
  bin: string | null;
  durationMs: number;
  warnings: string[];
  /** Account connectivity, where provable. */
  connection: Connection;
  /** What the proof actually said, e.g. "Logged in using ChatGPT". */
  connectionDetail: string | null;
  /** Quota/usage line, only from a provider that really reports it. */
  quota: string | null;
}

/** Files each CLI drops once a profile has actually been logged in. */
const CREDENTIAL_FILES: Record<string, string[]> = {
  claude: [".credentials.json", "credentials.json"],
  fcc: [".credentials.json", "credentials.json"], // same CLI, same shared login
  codex: ["auth.json"],
  kimi: ["credentials", "credentials.json"],
};

/** The CLI's own home, for shared-login (`none`) profiles. */
const DEFAULT_HOME: Record<string, string> = {
  claude: ".claude",
  fcc: ".claude",
  codex: ".codex",
  kimi: ".kimi-code",
};

function dirHasCredential(dir: string, cli: string): boolean {
  const names = CREDENTIAL_FILES[cli] ?? [];
  return names.some((n) => {
    const p = path.join(dir, n);
    if (!existsSync(p)) return false;
    // Kimi keeps its token at credentials/<provider>.json — a bare credentials/
    // directory (created at first launch, before login) is not a credential.
    try {
      if (statSync(p).isDirectory()) return readdirSync(p).length > 0;
    } catch { return false; }
    return true;
  });
}

function hasCredential(builder: Builder): boolean {
  if (builder.auth.kind === "api") return Object.keys(builder.auth.env ?? {}).length > 0;
  if (builder.auth.kind === "none") {
    // Shared-login profile: the credential lives in the CLI's own home, not the
    // profile's. It is still on-disk proof of *a* login — every shared-login
    // profile for this CLI bills that one account.
    const home = DEFAULT_HOME[builder.cli];
    return Boolean(home) && dirHasCredential(path.join(os.homedir(), home), builder.cli);
  }
  if (builder.auth.kind !== "oauth" || !builder.auth.configDir) return false;
  return dirHasCredential(builder.auth.configDir, builder.cli);
}

function firstLine(s: string): string {
  return s.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
}

function run(bin: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number) {
  return new Promise<{ ok: boolean; out: string; err: string }>((resolve) => {
    execFile(bin, args, { env, timeout: timeoutMs, windowsHide: true, maxBuffer: 1 << 20 },
      (err, stdout, stderr) => resolve({
        ok: !err,
        out: String(stdout ?? ""),
        err: err ? String(err.message ?? err) : String(stderr ?? ""),
      }));
  });
}

/** For CLIs that refuse to run without a console (agy.exe exits silently on a plain pipe). */
async function runPty(bin: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number) {
  try {
    const pty = await import("node-pty");
    const proc = pty.spawn(bin, args, {
      name: "xterm-256color", cols: 120, rows: 40,
      env: env as Record<string, string>, useConpty: true,
    });
    let out = "";
    proc.onData((d) => { out += d; });
    const code = await new Promise<number>((resolve) => {
      proc.onExit((e) => resolve(e.exitCode));
      setTimeout(() => { try { proc.kill(); } catch { /* gone */ } resolve(-1); }, timeoutMs);
    });
    const clean = out.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");
    return { ok: code === 0, out: clean, err: code === 0 ? "" : `exited ${code}` };
  } catch (e) {
    return { ok: false, out: "", err: e instanceof Error ? e.message : String(e) };
  }
}

// ------------------------------------------------------------------ API probes

interface ApiProbe {
  url: string;
  headers: (key: string) => Record<string, string>;
  /** Extract a quota line from a 200 response, if the endpoint reports one. */
  quota?: (body: string) => string | null;
}

/** Free liveness endpoints per known key type. 200 = alive, 401/403 = dead. */
const API_PROBES: Record<string, ApiProbe> = {
  ANTHROPIC_API_KEY: {
    url: "https://api.anthropic.com/v1/models",
    headers: (k) => ({ "x-api-key": k, "anthropic-version": "2023-06-01" }),
  },
  OPENAI_API_KEY: {
    url: "https://api.openai.com/v1/models",
    headers: (k) => ({ authorization: `Bearer ${k}` }),
  },
  MOONSHOT_API_KEY: {
    url: "https://api.moonshot.ai/v1/models",
    headers: (k) => ({ authorization: `Bearer ${k}` }),
  },
  OPENROUTER_API_KEY: {
    url: "https://openrouter.ai/api/v1/key",
    headers: (k) => ({ authorization: `Bearer ${k}` }),
    quota: (body) => {
      try {
        const d = (JSON.parse(body) as { data?: { usage?: number; limit?: number | null; is_free_tier?: boolean } }).data;
        if (!d || typeof d.usage !== "number") return null;
        const used = `$${d.usage.toFixed(2)} used`;
        if (typeof d.limit === "number") return `${used} of $${d.limit.toFixed(2)}`;
        return d.is_free_tier ? `${used} (free tier)` : `${used} (no limit set)`;
      } catch { return null; }
    },
  },
}

async function probeUrl(url: string, headers: Record<string, string>, quota?: (body: string) => string | null) {
  let res: Response;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(8_000), cache: "no-store" });
  } catch (e) {
    return { connection: "unverified" as Connection, detail: `Could not reach the provider: ${e instanceof Error ? e.message : e}.`, quota: null };
  }
  if (res.status === 401 || res.status === 403) {
    return { connection: "not-connected" as Connection, detail: `The provider refused this key (${res.status}).`, quota: null };
  }
  if (!res.ok) {
    return { connection: "unverified" as Connection, detail: `The provider answered ${res.status} — neither accepted nor refused.`, quota: null };
  }
  const body = await res.text().catch(() => "");
  return { connection: "connected" as Connection, detail: "The provider accepted this key.", quota: quota?.(body) ?? null };
}

async function probeApiKey(apiKeyEnv: string, key: string): Promise<{ connection: Connection; detail: string; quota: string | null }> {
  const probe = API_PROBES[apiKeyEnv];
  if (!probe) {
    return { connection: "unverified", detail: `No known free endpoint to test ${apiKeyEnv} against.`, quota: null };
  }
  return probeUrl(probe.url, probe.headers(key), probe.quota);
}

// -------------------------------------------- native codex -p provider check

/** Read one KEY from a dotenv file without printing anything anywhere. */
function dotenvValue(file: string, key: string): string | null {
  try {
    const m = readFileSync(file, "utf8").match(new RegExp(`^${key}=(.*)$`, "m"));
    if (!m) return null;
    return m[1].trim().replace(/^["']|["']$/g, "") || null;
  } catch { return null; }
}

/**
 * A `codex -p <name>` profile that routes to a custom provider (fugu → sakana)
 * is proven against THAT provider's key — `codex login status` only describes
 * the default ChatGPT login and would lie about this profile. Codex reads the
 * key from the environment or from `$CODEX_HOME/.env`.
 */
async function probeNativeProvider(
  provider: { name: string; envKey: string | null; baseUrl: string | null },
  spawnEnv: NodeJS.ProcessEnv,
): Promise<{ connection: Connection; detail: string; quota: string | null }> {
  if (!provider.envKey) {
    return { connection: "unverified", detail: `Provider "${provider.name}" declares no env_key to check.`, quota: null };
  }
  const codexHome = String(spawnEnv.CODEX_HOME || path.join(os.homedir(), ".codex"));
  const key = spawnEnv[provider.envKey] ?? dotenvValue(path.join(codexHome, ".env"), provider.envKey);
  if (!key) {
    return {
      connection: "not-connected",
      detail: `${provider.envKey} is not set in the environment or ${path.join(codexHome, ".env")} — the "${provider.name}" provider has no key.`,
      quota: null,
    };
  }
  if (!provider.baseUrl) {
    return { connection: "connected", detail: `${provider.envKey} is set; provider "${provider.name}" declares no base_url to probe.`, quota: null };
  }
  const r = await probeUrl(`${provider.baseUrl.replace(/\/+$/, "")}/models`, { authorization: `Bearer ${key}` });
  return { ...r, detail: `Provider "${provider.name}": ${r.detail}` };
}

// -------------------------------------------- agy quota (antigravity-usage)

/**
 * Antigravity quota has no flag on agy.exe itself — the source is the Google
 * Cloud Code API, and the user's `antigravity-usage` npm package already
 * speaks it (`quota --json`, verified live 2026-07-29: per-model remaining %
 * and reset times). Spawned as `node <dist/index.js>` because the package's
 * bin is a .cmd shim, which Node cannot spawn on Windows.
 */
async function probeAgyUsage(env: NodeJS.ProcessEnv): Promise<{ quota: string | null; detail: string | null }> {
  const script = path.join(os.homedir(), "AppData", "Roaming", "npm", "node_modules", "antigravity-usage", "dist", "index.js");
  if (!existsSync(script)) return { quota: null, detail: null };

  interface AgyModel { label?: string; remainingPercentage?: number; resetTime?: string; isAutocompleteOnly?: boolean }
  interface AgyUsage { email?: string; models?: AgyModel[] }
  const res = await new Promise<{ ok: boolean; out: string }>((resolve) => {
    execFile(process.execPath, [script, "quota", "--json", "--refresh"], {
      env, timeout: 20_000, windowsHide: true, maxBuffer: 1 << 20,
    }, (err, stdout) => resolve({ ok: !err, out: String(stdout ?? "") }));
  });
  if (!res.ok) return { quota: null, detail: "antigravity-usage could not answer — quota unknown." };

  let u: AgyUsage;
  try { u = JSON.parse(res.out) as AgyUsage; } catch { return { quota: null, detail: "antigravity-usage answered in an unexpected shape." }; }

  const fmtReset = (iso?: string): string => {
    const ms = iso ? new Date(iso).getTime() - Date.now() : 0;
    if (ms <= 0) return "soon";
    const h = Math.floor(ms / 3600_000), m = Math.round((ms % 3600_000) / 60_000);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };
  const lanes = (u.models ?? [])
    .filter((m) => !m.isAutocompleteOnly && typeof m.remainingPercentage === "number" && m.label)
    .sort((a, b) => (a.remainingPercentage ?? 1) - (b.remainingPercentage ?? 1));
  if (!lanes.length) return { quota: null, detail: u.email ? `account ${u.email}.` : null };

  // Group models that share the same quota pool (identical remaining% and reset time).
  // Within Antigravity, "Gemini Models" and "Claude & GPT Models" are separate pools.
  const poolKey = (m: AgyModel) => `${m.remainingPercentage?.toFixed(6)}@${m.resetTime ?? ""}`;
  const pools = new Map<string, AgyModel[]>();
  for (const m of lanes) {
    const k = poolKey(m);
    (pools.get(k) ?? (pools.set(k, []), pools.get(k)!)).push(m);
  }
  // Name each pool by its member labels
  const poolLabel = (members: AgyModel[]): string => {
    const labels = members.map((m) => m.label ?? "");
    const hasGemini = labels.some((l) => /gemini/i.test(l));
    const hasClaude = labels.some((l) => /claude|gpt|openai/i.test(l));
    if (hasGemini && !hasClaude) return "Gemini";
    if (hasClaude && !hasGemini) return "Claude & GPT";
    // Mixed or unknown: use shortest label as representative
    return labels.sort((a, b) => a.length - b.length)[0] ?? "Models";
  };
  // Show all pools sorted by tightest first
  const sorted = [...pools.values()].sort((a, b) =>
    (a[0].remainingPercentage ?? 1) - (b[0].remainingPercentage ?? 1));
  const parts = sorted.map((members) => {
    const rep = members[0];
    const pct = (rep.remainingPercentage! * 100).toFixed(1).replace(/\.0$/, "");
    return `${poolLabel(members)} ${pct}% (resets in ${fmtReset(rep.resetTime)})`;
  });
  return { quota: parts.join(" · "), detail: u.email ? `account ${u.email}.` : null };
}

/**
 * A kimi profile home's custom provider, if its config.toml declares one
 * (shape written by Router→CLI: [providers."x"] with base_url + api_key).
 * Line-scoped, not a TOML parser — same discipline as the codex profile reads.
 */
function kimiCustomProvider(configDir: string): { name: string; baseUrl: string; key: string } | null {
  let text: string;
  try { text = readFileSync(path.join(configDir, "config.toml"), "utf8"); } catch { return null; }
  let inSection = false, name = "", baseUrl = "", key = "";
  for (const line of text.split(/\r?\n/)) {
    const section = line.match(/^\[providers\."([^"]+)"\]/);
    if (section) { if (inSection && baseUrl && key) break; inSection = true; name = section[1]; baseUrl = ""; key = ""; continue; }
    if (line.startsWith("[")) { if (inSection && baseUrl && key) break; inSection = false; continue; }
    if (!inSection) continue;
    baseUrl = baseUrl || (line.match(/^\s*base_url\s*=\s*"([^"]+)"/)?.[1] ?? "");
    key = key || (line.match(/^\s*api_key\s*=\s*"([^"]+)"/)?.[1] ?? "");
  }
  return baseUrl && key ? { name, baseUrl, key } : null;
}

/**
 * Codex's own TUI has no scriptable quota command (`/quota` does not exist on
 * 0.145.0; `/status` is interactive-only). The TUI itself reads limits from
 * the ChatGPT backend, and so do we: GET /backend-api/wham/usage with the
 * stored OAuth token — verified live 2026-07-28 (plan_type, rate_limit
 * windows, credits). Faster and stabler than driving the TUI through a PTY.
 */
async function probeCodexUsage(codexHome: string): Promise<{ connection?: Connection; detail?: string; quota: string | null }> {
  interface CodexAuth { tokens?: { access_token?: string; account_id?: string } }
  let auth: CodexAuth;
  try { auth = JSON.parse(readFileSync(path.join(codexHome, "auth.json"), "utf8")) as CodexAuth; }
  catch { return { quota: null }; }
  const token = auth.tokens?.access_token;
  if (!token) return { quota: null, detail: `No ChatGPT token in ${path.join(codexHome, "auth.json")}.` };

  let res: Response;
  try {
    res = await fetch("https://chatgpt.com/backend-api/wham/usage", {
      headers: { authorization: `Bearer ${token}`, "chatgpt-account-id": auth.tokens?.account_id ?? "" },
      signal: AbortSignal.timeout(8_000), cache: "no-store",
    });
  } catch (e) {
    return { connection: "unverified", detail: `Could not reach the ChatGPT backend: ${e instanceof Error ? e.message : e}.`, quota: null };
  }
  if (res.status === 401 || res.status === 403) {
    return { connection: "not-connected", detail: `The ChatGPT backend rejected the stored token (${res.status}) — run codex login again.`, quota: null };
  }
  if (!res.ok) return { connection: "unverified", detail: `ChatGPT backend answered ${res.status}.`, quota: null };

  interface Window { used_percent?: number; reset_after_seconds?: number }
  interface Usage {
    plan_type?: string;
    rate_limit?: { limit_reached?: boolean; primary_window?: Window | null; secondary_window?: Window | null };
    credits?: { has_credits?: boolean; balance?: string; unlimited?: boolean };
  }
  const u = await res.json().catch(() => null) as Usage | null;
  if (!u) return { connection: "unverified", detail: "ChatGPT backend answered without a usage body.", quota: null };

  const fmtReset = (sec?: number): string => {
    if (!sec || sec <= 0) return "soon";
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
    return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  };
  const parts: string[] = [];
  if (u.plan_type) parts.push(u.plan_type.charAt(0).toUpperCase() + u.plan_type.slice(1));
  const pw = u.rate_limit?.primary_window;
  if (pw && typeof pw.used_percent === "number") parts.push(`weekly ${pw.used_percent}% used (resets in ${fmtReset(pw.reset_after_seconds)})`);
  const sw = u.rate_limit?.secondary_window;
  if (sw && typeof sw.used_percent === "number") parts.push(`5h ${sw.used_percent}% used (resets in ${fmtReset(sw.reset_after_seconds)})`);
  if (u.rate_limit?.limit_reached) parts.push("LIMIT REACHED");
  if (u.credits?.has_credits && u.credits.balance) parts.push(`credits ${u.credits.balance}`);
  return { quota: parts.length ? parts.join(" · ") : null };
}

// ------------------------------------------------------------- auth status

interface PtyProc {
  write(data: string): void;
  kill(): void;
  onData(cb: (data: string) => void): void;
}

/**
 * Kimi exposes plan quotas only inside its TUI (/usage). Drive that TUI through
 * a PTY: boot, wait for the ready status line, send /usage, parse the panel.
 * The panel answering at all proves the profile is signed in; its numbers are
 * the quota. node-pty is loaded lazily — a broken native install degrades to
 * "unverified", not a probe crash.
 */
async function probeKimiTui(bin: string, env: NodeJS.ProcessEnv): Promise<{ connection: Connection; detail: string; quota: string | null }> {
  let pty: typeof import("node-pty");
  try { pty = await import("node-pty"); }
  catch (e) { return { connection: "unverified", detail: `node-pty failed to load: ${e instanceof Error ? e.message : e}.`, quota: null }; }

  let out = "";
  let proc: PtyProc;
  try {
    proc = pty.spawn(bin, [], {
      name: "xterm-256color", cols: 120, rows: 36,
      env: env as Record<string, string>, useConpty: true,
    }) as unknown as PtyProc;
  } catch (e) {
    return { connection: "unverified", detail: `Could not start the kimi TUI: ${e instanceof Error ? e.message : e}.`, quota: null };
  }
  proc.onData((d) => { out += d; });

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  try {
    // "context:" sits in the status line of a ready, signed-in session.
    let ready = false;
    for (let i = 0; i < 25 && !ready; i++) { await sleep(1_000); ready = out.includes("context:"); }
    if (!ready) {
      return { connection: "not-connected", detail: "The kimi TUI never reached a ready prompt — this profile is most likely not signed in.", quota: null };
    }

    proc.write("/usage\r");
    await sleep(4_000);

    const clean = out.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").replace(/\x1b\][^\x07]*\x07/g, "");
    const quotas: string[] = [];
    for (const line of clean.split(/\r?\n/)) {
      const m = line.match(/(Weekly limit|5h limit)\s+\S*\s*(\d+)% used\s*(resets in [^│\n]*)/i);
      // The panel is re-rendered into the buffer on every repaint — dedupe.
      if (m) {
        const q = `${m[1].replace(" limit", "")} ${m[2]}% (${m[3].trim()})`;
        if (!quotas.includes(q)) quotas.push(q);
      }
    }
    if (!quotas.length) {
      return { connection: "connected", detail: "The /usage panel answered, but no plan quota lines could be parsed.", quota: null };
    }
    return { connection: "connected", detail: "The /usage panel answered (TUI probe).", quota: quotas.join(" · ") };
  } finally {
    try { proc.kill(); } catch { /* already gone */ }
  }
}

function readAuthStatus(cli: string, out: string, errText: string, ok: boolean): { connection: Connection; detail: string } {
  // These status commands are not consistent about which stream they print to
  // (codex login status writes to stderr on 0.145.0) — read both.
  const text = `${out}\n${errText}`;
  if (cli === "claude") {
    try {
      const j = JSON.parse(text.trim()) as { loggedIn?: boolean; authMethod?: string; apiProvider?: string };
      if (j.loggedIn === true) {
        const how = [j.authMethod, j.apiProvider].filter(Boolean).join(" · ");
        return { connection: "connected", detail: `Signed in${how ? ` (${how})` : ""}.` };
      }
      if (j.loggedIn === false) return { connection: "not-connected", detail: "claude auth status reports loggedIn: false." };
    } catch { /* fall through */ }
    return { connection: "unverified", detail: "claude auth status did not answer in the expected shape." };
  }
  if (cli === "codex") {
    const line = firstLine(text);
    if (ok && /logged in/i.test(line)) return { connection: "connected", detail: `${line}.` };
    return { connection: "not-connected", detail: line ? `codex login status: ${line}.` : "codex login status found no login." };
  }
  if (cli === "antigravity") {
    // `agy models` answers with a model list only when the OAuth session works.
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("Usage"));
    if (ok && lines.length > 0) return { connection: "connected", detail: `agy models answered (${lines.length} models).` };
    return { connection: "not-connected", detail: "agy models returned nothing — the Antigravity account is not signed in." };
  }
  return { connection: "unverified", detail: "No auth-status reading for this CLI." };
}

// -------------------------------------------------------------------- probe

export async function probeBuilder(builder: Builder, opts: { timeoutMs?: number } = {}): Promise<BuilderHealth> {
  const started = Date.now();
  const base = { connection: "unverified" as Connection, connectionDetail: null, quota: null };

  let resolved;
  try {
    resolved = resolveBuilderSpawn(builder);
  } catch (e) {
    return {
      state: "fail",
      message: e instanceof BuilderSpawnError ? e.message : String(e),
      version: null, bin: builder.bin, durationMs: Date.now() - started, warnings: [],
      ...base,
    };
  }

  const { spec, binOverride, extraEnv, warnings } = resolved;
  const env = agentEnv(extraEnv);

  const result = builder.cli === "antigravity"
    ? await runPty(binOverride!, [...(builder.args ?? []), ...spec.versionArgs], env, opts.timeoutMs ?? 15_000)
    : await run(binOverride!, [...(builder.args ?? []), ...spec.versionArgs], env, opts.timeoutMs ?? 15_000);
  const durationMs = Date.now() - started;

  if (!result.ok) {
    return {
      state: "fail",
      message: `${spec.label} would not start: ${firstLine(result.err) || "no output"}`,
      version: null, bin: binOverride ?? null, durationMs, warnings,
      ...base,
    };
  }

  const version = firstLine(result.out) || firstLine(result.err) || null;

  // --- connection proof, where one exists -------------------------------
  let connection: Connection = "unverified";
  let connectionDetail: string | null = null;
  let quota: string | null = null;

  if (builder.auth.kind === "api") {
    // An API-key profile wants liveness, not local key presence — probe the
    // provider even when the CLI has an auth-status command.
    const envKey = spec.apiKeyEnv ?? "";
    const key = (builder.auth.env ?? {})[envKey] ?? Object.values(builder.auth.env ?? {})[0];
    if (key) {
      // A base-URL override (claude-fugu → Sakana) must be probed at ITS base,
      // not the vendor's — the key means nothing to api.anthropic.com.
      const customBase = (builder.env ?? {}).ANTHROPIC_BASE_URL ?? (builder.auth.env ?? {}).ANTHROPIC_BASE_URL;
      const r = customBase
        ? await probeUrl(`${customBase.replace(/\/+$/, "")}/v1/models`, {
            "x-api-key": key, authorization: `Bearer ${key}`, "anthropic-version": "2023-06-01",
          })
        : await probeApiKey(envKey, key);
      connection = r.connection;
      connectionDetail = r.detail;
      quota = r.quota;
    }
  } else if (spec.authStatusArgs) {
    // A native `codex -p` profile that routes to a custom provider is checked
    // against that provider's key — login status would describe the wrong account.
    const sameArgs = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);
    const native = detectNativeProfiles().find((p) => p.cli === builder.cli && sameArgs(p.args, builder.args ?? []));
    if (native?.provider) {
      const r = await probeNativeProvider(native.provider, env);
      connection = r.connection;
      connectionDetail = r.detail;
      quota = r.quota;
    } else {
      // Deliberately without builder.args: codex's -p is rejected for non-runtime
      // commands (`login status` is one), and extra claude flags would only break
      // the subcommand. The isolation env already makes the answer per-profile.
      // agy.exe additionally refuses to run without a console, so it goes
      // through a PTY instead of a plain pipe.
      const st = builder.cli === "antigravity"
        ? await runPty(binOverride!, spec.authStatusArgs, env, 15_000)
        : await run(binOverride!, spec.authStatusArgs, env, 12_000);
      const r = readAuthStatus(builder.cli, st.out, st.err, st.ok);
      connection = r.connection;
      connectionDetail = r.detail;
      // A codex subscription login also carries real quota: the ChatGPT
      // backend's usage endpoint, read with the profile's own CODEX_HOME.
      if (builder.cli === "codex" && r.connection === "connected") {
        const u = await probeCodexUsage(String(env.CODEX_HOME || path.join(os.homedir(), ".codex")));
        if (u.connection === "not-connected") {
          connection = "not-connected";
          connectionDetail = u.detail ?? connectionDetail;
        } else if (u.quota) {
          quota = u.quota;
        }
      }
      // agy's quota comes from the antigravity-usage tool (Google Cloud Code
      // API) — spawned through node, never the .cmd shim. The tool has its own
      // credentials and works independently of `agy models`, so probe it
      // regardless of auth status. Use process.env (not the builder's env)
      // because antigravity-usage reads its own cached credentials from the
      // user's home, not from builder env vars.
      if (builder.cli === "antigravity") {
        const u = await probeAgyUsage(process.env);
        if (u.quota) quota = u.quota;
        if (u.detail) connectionDetail = [r.detail, u.detail].filter(Boolean).join(" ");
      }
    }
  } else if (spec.usageViaTui) {
    // A kimi oauth profile can point at a custom provider in its own
    // config.toml (Router→CLI writes one). That profile bills the provider,
    // not the Kimi account — and its home has no Kimi credentials, so the TUI
    // panel would lie "not signed in". Probe the provider instead, the same
    // rule as codex's -p branch.
    const providerHome = builder.auth.kind === "oauth" && builder.auth.configDir
      ? builder.auth.configDir : null;
    const custom = providerHome ? kimiCustomProvider(providerHome) : null;
    if (custom) {
      const r = await probeUrl(`${custom.baseUrl.replace(/\/+$/, "")}/models`, {
        authorization: `Bearer ${custom.key}`, "x-api-key": custom.key,
      });
      connection = r.connection;
      connectionDetail = `Provider "${custom.name}": ${r.detail}`;
      quota = null; // sakana-class endpoints report no usage numbers — unknown, not invented
    } else {
      const r = await probeKimiTui(binOverride!, env);
      connection = r.connection;
      connectionDetail = r.detail;
      quota = r.quota;
    }
  } else {
    connectionDetail = `${spec.label} has no scriptable auth or quota check — its identity cannot be proven without spending a request.`;
  }

  // --- the original three-state answer -----------------------------------
  if (builder.auth.kind === "none") {
    // A shared-login profile is verified when the native status check passes
    // or the CLI's own credential is on disk — it is a real login, just not
    // the profile's own. Hiding it would bury profiles that work fine.
    const verified = connection === "connected" || hasCredential(builder);
    return {
      state: connection === "not-connected" ? "fail" : verified ? "ok" : "auth-unverified",
      message: connection === "connected"
        ? `Runs, and the credential check passes (see the connection line).`
        : connection === "not-connected"
          ? `Runs, but the credential check FAILS — nothing using this profile will work until that is fixed.`
          : verified
            ? `Runs on ${spec.label}'s shared login, found on disk — every shared-login profile for this CLI bills that same account.`
            : `Runs. This profile uses ${spec.label}'s existing login, whichever account that is.`,
      version, bin: binOverride ?? null, durationMs, warnings,
      connection, connectionDetail, quota,
    };
  }

  if (!hasCredential(builder)) {
    // A live connection beats the credential-file heuristic: kimi-fugu's home
    // holds a provider key inside config.toml, not a credentials file, yet it
    // provably works. Only when the probe says nothing do we claim "no
    // credential yet".
    if (connection === "connected") {
      return {
        state: "ok",
        message: "Runs, and the provider check passes (see the connection line).",
        version, bin: binOverride ?? null, durationMs, warnings,
        connection, connectionDetail, quota,
      };
    }
    const how = builder.auth.kind === "oauth"
      ? "Log in from the profile's own terminal to give it an account."
      : "Add an API key to this profile.";
    return {
      state: "auth-unverified",
      message: `Runs, but this profile has no credential yet. ${how}`,
      version, bin: binOverride ?? null, durationMs, warnings,
      connection, connectionDetail, quota,
    };
  }

  return {
    state: connection === "not-connected" ? "fail" : "ok",
    message: connection === "connected"
      ? "Runs, and the account checks out."
      : connection === "not-connected"
        ? "Runs, but the account behind this profile is rejected — see the connection line."
        : builder.auth.kind === "api"
          ? "Runs, and an API key is set. Whether the key is still valid is only proven by a real request."
          : "Runs, and this profile has its own login on disk. An expired session still looks like this — only a real request proves it.",
    version, bin: binOverride ?? null, durationMs, warnings,
    connection, connectionDetail, quota,
  };
}
