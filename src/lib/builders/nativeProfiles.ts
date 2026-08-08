// Detection of the *CLI's own* native profiles — profiles the CLI knows about,
// made outside Agent OS, that a Builder can wrap.
//
// A Builder profile and a CLI-native profile are different things living in
// different places: Builders are Agent OS's registry in builders.json; native
// profiles are the CLI's own config. Until something imports one, the dashboard
// cannot see it — this module is the bridge. Detection is read-only; importing
// is an explicit user action (POST /api/builders/import-native).
//
// Only mechanisms verified against a real install get a detector. Today that is
// exactly one: codex `-p <name>`, which layers `$CODEX_HOME/<name>.config.toml`
// on top of the base config (confirmed against codex-cli 0.145.0, 2026-07-27).
// Claude Code and Kimi Code isolate per environment variable instead and have
// no native profile concept — there is nothing to detect. Add a detector here
// when another CLI's mechanism is proven, not before.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";

export interface NativeProvider {
  name: string;
  /** Env var the provider's key is read from (codex `env_key`). */
  envKey: string | null;
  baseUrl: string | null;
}

export interface NativeProfile {
  cli: string;
  /** The name the CLI knows it by, e.g. `fugu` in `codex -p fugu`. */
  name: string;
  /** Args that invoke it; stored on the imported Builder. */
  args: string[];
  /** Where it was found, for display. */
  source: string;
  /**
   * Set when the profile routes to a custom provider instead of the CLI's own
   * login (codex `model_provider`). The health probe checks THIS credential —
   * `codex login status` would only describe the default ChatGPT login and
   * say nothing about the provider's key.
   */
  provider?: NativeProvider;
}

// Not a TOML parser — three narrow reads against files codex itself wrote.
// Good enough for detection; anything richer is a real parser's job (YAGNI).
function readScalar(file: string, key: string): string | null {
  let text: string;
  try { text = readFileSync(file, "utf8"); } catch { return null; }
  const m = text.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"`, "m"));
  return m ? m[1] : null;
}

/** Find `[model_providers.<name>]` in a config file and read env_key/base_url. */
function readProviderDef(configFile: string, name: string): { envKey: string | null; baseUrl: string | null } | null {
  let text: string;
  try { text = readFileSync(configFile, "utf8"); } catch { return null; }
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const header = new RegExp(`^\\[model_providers\\.(?:"${esc}"|${esc})\\]`);
  // Line-based, not one big regex: a multiline `$` matches at every line end,
  // so a lazy "until next section or $" capture stops before it starts.
  let inSection = false;
  const body: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("[")) {
      if (inSection) break;
      inSection = header.test(line);
      continue;
    }
    if (inSection) body.push(line);
  }
  if (!body.length) return null;
  const text2 = body.join("\n");
  const envKey = text2.match(/^\s*env_key\s*=\s*"([^"]+)"/m)?.[1] ?? null;
  const baseUrl = text2.match(/^\s*base_url\s*=\s*"([^"]+)"/m)?.[1] ?? null;
  return { envKey, baseUrl };
}

function detectCodexProfiles(): NativeProfile[] {
  const home = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  let files: string[];
  try { files = readdirSync(home); } catch { return []; }

  const profiles: NativeProfile[] = [];

  // Default profile: config.toml (no prefix, runs as plain `codex`)
  if (files.includes("config.toml")) {
    const source = path.join(home, "config.toml");
    const model = readScalar(source, "model");
    const profile: NativeProfile = {
      cli: "codex", name: "default", args: [], source,
    };
    // Read provider info from the base config if model_provider is set
    const providerName = readScalar(source, "model_provider");
    if (providerName) {
      const def = readProviderDef(source, providerName);
      profile.provider = { name: providerName, envKey: def?.envKey ?? null, baseUrl: def?.baseUrl ?? null };
    }
    if (model) {
      profile.provider = { ...profile.provider, name: profile.provider?.name ?? "openai", envKey: profile.provider?.envKey ?? null, baseUrl: profile.provider?.baseUrl ?? null };
    }
    profiles.push(profile);
  }

  // Named profiles: <name>.config.toml (runs as `codex -p <name>`)
  const named = files
    .filter((f) => f.length > ".config.toml".length && f.endsWith(".config.toml"))
    .map((f) => f.slice(0, -".config.toml".length))
    .sort();

  for (const name of named) {
    const source = path.join(home, `${name}.config.toml`);
    const profile: NativeProfile = { cli: "codex", name, args: ["-p", name], source };
    const providerName = readScalar(source, "model_provider");
    if (providerName) {
      const def = readProviderDef(path.join(home, "config.toml"), providerName)
        ?? readProviderDef(source, providerName);
      profile.provider = { name: providerName, envKey: def?.envKey ?? null, baseUrl: def?.baseUrl ?? null };
    }
    profiles.push(profile);
  }

  return profiles;
}

const DETECTORS: Record<string, () => NativeProfile[]> = {
  codex: detectCodexProfiles,
};

export function detectNativeProfiles(): NativeProfile[] {
  return Object.values(DETECTORS).flatMap((detect) => {
    try { return detect(); } catch { return []; }
  });
}
