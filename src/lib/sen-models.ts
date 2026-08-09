// The models a Builder can actually run — read from the CLI's own config on
// this machine, never invented. A chat model picker is only as honest as this
// list: kimi reads the profile's config.toml ([models.*] + default_model),
// codex reads its config's top-level model, claude is the documented two
// (install/7-AGENT-CLIS.md). Anything else is "custom" — typed by hand, and
// the CLI's own error answers if it is wrong.

import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn as spawnProc } from "node:child_process";
import type { Builder } from "./builders/registry";
import { cliSpec, defaultBinFor } from "./builders/clis";
import { resolveBuilderSpawn } from "./builders/spawn";
import { codexProfileTranslation } from "./builders/codex-profile";
import { agentEnv, killTree } from "./runner";

export interface ModelChoice {
  id: string;
  note?: string;
  /**
   * Reasoning efforts this model's catalog declares (codex `models_cache.json`
   * and `-p` catalogs carry `supported_reasoning_levels`; the live app-server
   * model/list carries the same). Undefined when nothing declares them — the
   * UI must fall back to the generic list, never invent levels.
   */
  effortLevels?: string[];
}

/** codex catalogs write `supported_reasoning_levels: [{effort, description}]`. */
function parseEffortLevels(m: { supported_reasoning_levels?: { effort?: string }[] }): string[] | undefined {
  const levels = (m.supported_reasoning_levels ?? []).map((l) => l.effort).filter((v): v is string => Boolean(v));
  return levels.length ? levels : undefined;
}
export interface BuilderModels {
  models: ModelChoice[];
  /** The CLI's configured default (what runs when nothing overrides). */
  cliDefault: string | null;
  /** Where the list came from, shown so a wrong list has an obvious cause. */
  source: string;
}

/** How hard to work for a model list. Page loads use cache/config only. */
export interface ModelsResolveOpts {
  /** Spawn CLIs (codex app-server, agy PTY). Off by default — too slow for navigation. */
  live?: boolean;
  signal?: AbortSignal;
}

function configHome(builder: Builder, defaultDir: string): string {
  return builder.auth.kind === "oauth" && builder.auth.configDir
    ? builder.auth.configDir
    : path.join(os.homedir(), defaultDir);
}

async function readToml(p: string): Promise<string | null> {
  try { return await readFile(p, "utf8"); } catch { return null; }
}

async function kimiModels(builder: Builder): Promise<BuilderModels> {
  const home = configHome(builder, ".kimi-code");
  const source = path.join(home, "config.toml");
  const toml = await readToml(source);
  if (!toml) return { models: [], cliDefault: null, source: `${source} (unreadable)` };
  const cliDefault = toml.match(/^\s*default_model\s*=\s*"([^"]+)"/m)?.[1] ?? null;
  const models: ModelChoice[] = [];
  for (const m of toml.matchAll(/^\s*\[models\."([^"]+)"\]/gm)) {
    models.push({ id: m[1], note: m[1] === cliDefault ? "CLI default" : undefined });
  }
  return { models, cliDefault, source };
}

/**
 * The LIVE codex model catalog via `codex app-server`'s model/list RPC —
 * display names plus per-model supported reasoning efforts. Returns null on
 * any failure (caller falls back to the config-derived list).
 */
async function codexLiveModels(builder: Builder, signal?: AbortSignal): Promise<BuilderModels | null> {
  if (signal?.aborted) return null;
  let child: ReturnType<typeof spawnProc> | null = null;
  try {
    const resolved = resolveBuilderSpawn(builder);
    if (!resolved.binOverride) return null;
    const t = await codexProfileTranslation(builder, [...(resolved.argsPrefix ?? [])]);
    const proc = spawnProc(resolved.binOverride, [...t.argv, "app-server"], {
      env: agentEnv({ ...resolved.extraEnv, ...t.env }),
      windowsHide: true,
    });
    child = proc;
    return await new Promise<BuilderModels | null>((resolve) => {
      let buf = "";
      let id = 0;
      const done = (v: BuilderModels | null) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        killTree(proc);
        resolve(v);
      };
      const onAbort = () => done(null);
      signal?.addEventListener("abort", onAbort, { once: true });
      const call = (method: string, params: unknown) => {
        proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) + "\n");
      };
      const timer = setTimeout(() => done(null), 10_000);
      proc.stdout.on("data", (b: Buffer) => {
        buf += b.toString();
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line) continue;
          let m: { id?: number; result?: unknown; error?: { message?: string } };
          try { m = JSON.parse(line); } catch { continue; }
          if (m.id === 1) {
            call("model/list", {});
          } else if (m.id === 2) {
            interface LiveModel { id?: string; displayName?: string; supportedReasoningEfforts?: { reasoningEffort?: string }[] }
            const data = ((m.result as { data?: LiveModel[] } | undefined)?.data) ?? [];
            const models = data
              .filter((x) => x.id)
              .map((x) => {
                const levels = (x.supportedReasoningEfforts ?? []).map((e) => e.reasoningEffort).filter((v): v is string => Boolean(v));
                return {
                  id: String(x.id),
                  note: [
                    x.displayName && x.displayName !== x.id ? x.displayName : undefined,
                    levels.join("/") || undefined,
                  ].filter(Boolean).join(" · ") || undefined,
                  effortLevels: levels.length ? levels : undefined,
                };
              });
            done(models.length ? { models, cliDefault: t.model, source: "codex app-server model/list (live)" } : null);
          }
        }
      });
      proc.on("error", () => done(null));
      proc.on("close", () => done(null));
      call("initialize", { clientInfo: { name: "agentic-os-models", version: "1.0" } });
    });
  } catch {
    child?.kill();
    return null;
  }
}

async function codexCachedModels(builder: Builder): Promise<BuilderModels> {
  const home = configHome(builder, ".codex");
  const source = path.join(home, "config.toml");
  const toml = await readToml(source);

  // A `-p <name>` profile answers from its own layered config, and may carry a
  // private catalog (`model_catalog_json` — fugu.json is one model, not the
  // ChatGPT list). Read the profile first; the shared cache/config is fallback.
  const pIdx = (builder.args ?? []).indexOf("-p");
  const profileName = pIdx >= 0 ? builder.args[pIdx + 1] : null;
  if (profileName) {
    const pSource = path.join(home, `${profileName}.config.toml`);
    const pToml = await readToml(pSource);
    const catalogPath = pToml?.match(/^\s*model_catalog_json\s*=\s*"([^"]+)"/m)?.[1];
    const pDefault = pToml?.match(/^\s*model\s*=\s*"([^"]+)"/m)?.[1] ?? null;
    if (catalogPath) {
      interface CatalogModel { slug?: string; display_name?: string; supported_reasoning_levels?: { effort?: string }[] }
      try {
        const catalog = JSON.parse(await readFile(catalogPath, "utf8")) as { models?: CatalogModel[] };
        const models = (catalog.models ?? [])
          .filter((m) => m.slug)
          .map((m) => ({
            id: String(m.slug),
            note: m.display_name && m.display_name !== m.slug ? m.display_name : undefined,
            effortLevels: parseEffortLevels(m),
          }));
        if (models.length) return { models, cliDefault: pDefault ?? models[0].id, source: catalogPath };
      } catch { /* catalog unreadable — fall through */ }
    }
    if (pDefault) return { models: [{ id: pDefault, note: "from profile config" }], cliDefault: pDefault, source: pSource };
  }

  const cliDefault = toml?.match(/^\s*model\s*=\s*"([^"]+)"/m)?.[1] ?? null;

  // The real subscription model list lives in codex's own cache, refreshed by
  // the CLI from the ChatGPT backend — slugs, display names, descriptions.
  // Far more honest than a hardcoded guess.
  const cacheSource = path.join(home, "models_cache.json");
  interface CacheModel { slug?: string; display_name?: string; description?: string; supported_reasoning_levels?: { effort?: string }[] }
  try {
    const cache = JSON.parse(await readFile(cacheSource, "utf8")) as { models?: CacheModel[] };
    const models = (cache.models ?? [])
      .filter((m) => m.slug)
      .map((m) => ({
        id: String(m.slug),
        note: m.display_name && m.display_name !== m.slug ? m.display_name : m.description?.slice(0, 60),
        effortLevels: parseEffortLevels(m),
      }));
    if (models.length) return { models, cliDefault, source: cacheSource };
  } catch { /* no cache — fall through to the config-only answer */ }

  return {
    models: cliDefault ? [{ id: cliDefault, note: "from codex config" }] : [],
    cliDefault,
    source,
  };
}

export async function codexModels(builder: Builder, opts: ModelsResolveOpts = {}): Promise<BuilderModels> {
  if (opts.live) {
    const live = await codexLiveModels(builder, opts.signal);
    if (live) return live;
  }
  return codexCachedModels(builder);
}

async function claudeModels(builder: Builder, opts: ModelsResolveOpts = {}): Promise<BuilderModels> {
  // An API-key profile can ask its provider for the real list its key sees.
  // The provider is not always Anthropic: a base-URL override (claude-fugu →
  // Sakana) means the list lives at THAT host — asking api.anthropic.com
  // would return the wrong account's models, the same class of bug as the
  // health probe had. The documented pair stays the fallback for OAuth logins
  // and endpoint failures.
  const key = builder.auth.kind === "api" ? (builder.auth.env?.ANTHROPIC_API_KEY ?? Object.values(builder.auth.env ?? {})[0]) : undefined;
  if (key && opts.live) {
    const customBase = (builder.env ?? {}).ANTHROPIC_BASE_URL ?? (builder.auth.env ?? {}).ANTHROPIC_BASE_URL;
    const host = (customBase ? customBase.replace(/\/+$/, "") : "https://api.anthropic.com") + "/v1/models";
    try {
      const res = await fetch(host, {
        headers: { "x-api-key": key, authorization: `Bearer ${key}`, "anthropic-version": "2023-06-01" },
        signal: AbortSignal.timeout(8_000), cache: "no-store",
      });
      if (res.ok) {
        const j = await res.json() as { data?: { id?: string; display_name?: string }[] };
        const models = (j.data ?? []).filter((m) => m.id).map((m) => ({ id: String(m.id), note: m.display_name }));
        if (models.length) {
          return { models, cliDefault: builder.model ?? models[0].id, source: `${host} (live, this key)` };
        }
      }
    } catch { /* fall through */ }
  }
  // When a custom BASE_URL is set (router profile), don't return hardcoded
  // Anthropic models — routerModels() will handle it with the correct list.
  const customBase = (builder.env ?? {}).ANTHROPIC_BASE_URL ?? (builder.auth.env ?? {}).ANTHROPIC_BASE_URL;
  if (customBase) {
    return { models: [], cliDefault: builder.model ?? null, source: `${customBase} (no /v1/models response)` };
  }
  return {
    models: [
      { id: "claude-opus-4-8", note: "default — reliable, lighter on tokens" },
      { id: "claude-fable-5", note: "max power · ~2× cost" },
    ],
    cliDefault: builder.model ?? "claude-opus-4-8",
    source: "install/7-AGENT-CLIS.md (documented pair)",
  };
}

/**
 * agy's own `agy models` — the live list of the signed-in account, straight
 * from the CLI (verified 1.1.8). No config file to read instead.
 *
 * agy.exe refuses to run without a console (plain pipe spawn exits silently
 * with no output), so this goes through a PTY, the same reason the kimi quota
 * probe does.
 */
async function agyModels(builder: Builder, opts: ModelsResolveOpts = {}): Promise<BuilderModels> {
  const spec = cliSpec("antigravity");
  const bin = builder.bin ?? (spec ? defaultBinFor(spec) : null);
  if (!bin) return { models: [], cliDefault: null, source: "agy.exe not found" };
  if (!opts.live) {
    const id = builder.model;
    return {
      models: id ? [{ id, note: "profile override" }] : [],
      cliDefault: id,
      source: "agy models deferred (use live refresh for full list)",
    };
  }
  try {
    const pty = await import("node-pty");
    const proc = pty.spawn(bin, ["models"], {
      name: "xterm-256color", cols: 120, rows: 40,
      env: process.env as Record<string, string>, useConpty: true,
    });
    let out = "";
    proc.onData((d) => { out += d; });
    const code = await new Promise<number>((resolve) => {
      const timer = setTimeout(() => { try { proc.kill(); } catch { /* gone */ } resolve(-1); }, 15_000);
      const onAbort = () => { clearTimeout(timer); try { proc.kill(); } catch { /* gone */ } resolve(-1); };
      opts.signal?.addEventListener("abort", onAbort, { once: true });
      proc.onExit((e) => { clearTimeout(timer); opts.signal?.removeEventListener("abort", onAbort); resolve(e.exitCode); });
    });
    if (code !== 0) return { models: [], cliDefault: null, source: `agy models exited ${code}` };
    const clean = out.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");
    const models = clean.split(/\r?\n/).map((l) => l.trim())
      // agy prints "id<spaces>Display name" per line after a spinner preamble.
      // The last spinner frame merges into the first model line on the same
      // row, so strip spinner fragments before parsing — otherwise the first
      // model silently vanishes (11 printed, 10 parsed).
      .map((l) => l.replace(/.*Fetching available models\.\.\./g, "").replace(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/g, "").trim())
      .map((l) => l.match(/^(\S+)\s{2,}(.+)$/) ?? l.match(/^(\S+)$/))
      .filter((m): m is RegExpMatchArray => Boolean(m))
      .map((m) => ({ id: m[1], note: m[2]?.trim() || undefined }));
    if (models.length) return { models, cliDefault: builder.model ?? models[0].id, source: "agy models (live)" };
    return { models: [], cliDefault: null, source: "agy models returned nothing" };
  } catch (e) {
    return { models: [], cliDefault: null, source: `agy models failed: ${e instanceof Error ? e.message.split("\n")[0] : e}` };
  }
}

/**
 * Load routers from ~/.agentic-os/routers.json — the single source of truth
 * for provider base URLs and API keys.
 */
interface RouterEntry { id: string; name: string; baseUrl: string; apiKey: string; defaultModel?: string }
async function loadRouters(): Promise<RouterEntry[]> {
  try {
    const p = path.join(os.homedir(), ".agentic-os", "routers.json");
    const d = JSON.parse(await readFile(p, "utf8")) as { routers?: RouterEntry[] };
    return (d.routers ?? []).filter((r) => r.baseUrl && r.apiKey);
  } catch { return []; }
}

/**
 * Query a Router provider's /v1/models endpoint (OpenAI-compatible).
 *
 * Detects router builders through three signals, cross-referenced with
 * routers.json so ALL builders pointing at the same provider get the same
 * model list regardless of which CLI they wrap:
 *
 *   1. env contains ANTHROPIC_BASE_URL / OPENAI_BASE_URL → match by URL
 *   2. codex -p <profile> name matches a router slug (fugu, troll, etc.)
 *   3. builder notes mention a router name ("Troll API", "Fugu", "Sakana")
 *
 * Returns null when the builder isn't a router profile.
 */
async function routerModels(builder: Builder, opts: ModelsResolveOpts = {}): Promise<BuilderModels | null> {
  const routers = await loadRouters();

  let baseUrl: string | null = null;
  let apiKey: string | null = null;

  // Signal 1: env has a custom BASE_URL → match to a router by URL
  const envBase =
    (builder.env ?? {}).ANTHROPIC_BASE_URL ??
    (builder.env ?? {}).OPENAI_BASE_URL ??
    null;
  if (envBase) {
    baseUrl = envBase;
    // Try to find matching router for its API key (more reliable than auth.env)
    const matched = routers.find((r) => envBase.includes(new URL(r.baseUrl).hostname));
    apiKey = matched?.apiKey ?? Object.values(builder.auth?.env ?? {})[0] ?? null;
  }

  // Signal 2: codex -p <profile> name matches a router slug
  if (!baseUrl) {
    const pIdx = (builder.args ?? []).indexOf("-p");
    const profileName = pIdx >= 0 ? builder.args[pIdx + 1] : null;
    if (profileName) {
      const matched = routers.find((r) =>
        r.id === profileName ||
        r.id.replace(/-api$/, "") === profileName ||
        profileName.includes(r.id.replace(/-api$/, ""))
      );
      if (matched) { baseUrl = matched.baseUrl; apiKey = matched.apiKey; }
    }
  }

  // Signal 3: notes mention a router name/id
  if (!baseUrl && builder.notes) {
    const notesLower = builder.notes.toLowerCase();
    for (const r of routers) {
      if (notesLower.includes(r.name.toLowerCase()) || notesLower.includes(r.id.toLowerCase())) {
        baseUrl = r.baseUrl; apiKey = r.apiKey; break;
      }
    }
  }

  if (!baseUrl || !apiKey) return null;

  // Normalize: strip trailing /v1 if present so we always build /v1/models
  const cleanBase = baseUrl.replace(/\/v1\/?$/, "").replace(/\/+$/, "");
  const endpoint = cleanBase + "/v1/models";

  // Live /v1/models query — skipped on page loads; static catalogs are enough for dropdowns.
  if (opts.live) {
    try {
      const res = await fetch(endpoint, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        signal: opts.signal ?? AbortSignal.timeout(8_000),
        cache: "no-store",
      });
      if (res.ok) {
        const j = (await res.json()) as { data?: { id?: string; display_name?: string }[] };
        const models: ModelChoice[] = (j.data ?? [])
          .filter((m) => m.id)
          .map((m) => ({ id: String(m.id), note: m.display_name || undefined }));
        if (models.length) {
          return { models, cliDefault: builder.model ?? models[0].id, source: `${endpoint} (live)` };
        }
      }
    } catch { /* endpoint unavailable — fall through to static fallback */ }
  }

  // Static fallback catalogs for known providers
  const host = cleanBase.toLowerCase();
  if (host.includes("trollllm") || host.includes("troll")) {
    return {
      models: [
        { id: "gpt-5.6-sol", note: "GPT-5.6 Sol" },
        { id: "gpt-5.6-terra", note: "GPT-5.6 Terra" },
        { id: "gpt-5.6-luna", note: "GPT-5.6 Luna" },
        { id: "gpt-5.5", note: "GPT-5.5" },
        { id: "claude-opus-5", note: "Claude Opus 5" },
        { id: "claude-opus-4-8", note: "Claude Opus 4.8" },
        { id: "claude-opus-4-7", note: "Claude Opus 4.7" },
        { id: "claude-opus-4-6", note: "Claude Opus 4.6" },
        { id: "claude-sonnet-5", note: "Claude Sonnet 5" },
        { id: "claude-sonnet-4-6", note: "Claude Sonnet 4.6" },
        { id: "claude-fable-5", note: "Claude Fable 5" },
        { id: "claude-haiku-4-5-20251001", note: "Claude Haiku 4.5" },
      ],
      cliDefault: builder.model ?? "gpt-5.6-sol",
      source: `${cleanBase} (static catalog)`,
    };
  }
  if (host.includes("sakana") || host.includes("fugu")) {
    return {
      models: [
        { id: "fugu-ultra", note: "Fugu Ultra" },
        { id: "fugu", note: "Fugu" },
        { id: "fugu-cyber", note: "Fugu Cyber" },
      ],
      cliDefault: builder.model ?? "fugu-ultra",
      source: `${cleanBase} (static catalog)`,
    };
  }

  return null;
}

export async function modelsForBuilder(
  builder: Builder,
  opts: ModelsResolveOpts = {},
): Promise<BuilderModels> {
  if (opts.signal?.aborted) {
    return { models: [], cliDefault: null, source: "aborted" };
  }
  // Router provider models take priority — query the provider's /v1/models
  // endpoint before falling through to CLI-specific discovery.
  const router = await routerModels(builder, opts).catch(() => null);
  if (router && router.models.length > 0) return router;

  switch (builder.cli) {
    case "kimi": return kimiModels(builder);
    case "codex": return codexModels(builder, opts);
    case "antigravity": return agyModels(builder, opts);
    case "claude":
    case "fcc": return claudeModels(builder, opts);
    default: return { models: [], cliDefault: null, source: "no model list known for this CLI" };
  }
}
