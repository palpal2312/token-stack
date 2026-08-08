// Shared codex `-p <name>` profile translation.
//
// `codex exec` accepts `-p <name>` (the profile at <codexHome>/<name>.config.toml);
// `codex app-server` does not. Both callers — the persistent lane (acp.ts) and
// the model-list RPC helper (sen-models.ts) — need the same translation:
// flat keys become `-c key="value"` overrides, and the profile's [env] table
// becomes child environment so a key never sits on a process command line.

import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Builder } from "./registry";

export interface CodexProfileTranslation {
  argv: string[];
  env: Record<string, string>;
  model: string | null;
}

export async function codexProfileTranslation(
  builder: Builder,
  argsPrefix: string[],
): Promise<CodexProfileTranslation> {
  const pIdx = argsPrefix.indexOf("-p");
  if (pIdx < 0 || !argsPrefix[pIdx + 1]) return { argv: [...argsPrefix], env: {}, model: null };

  const name = argsPrefix[pIdx + 1];
  const home = builder.auth.kind === "oauth" && builder.auth.configDir
    ? builder.auth.configDir
    : path.join(os.homedir(), ".codex");
  let toml: string;
  try { toml = await readFile(path.join(home, `${name}.config.toml`), "utf8"); }
  catch { return { argv: [...argsPrefix], env: {}, model: null }; }

  const argv = argsPrefix.filter((_, i) => i !== pIdx && i !== pIdx + 1);
  const env: Record<string, string> = {};
  let model: string | null = null;

  const FLAT = ["model", "model_provider", "model_reasoning_effort", "model_catalog_json", "cli_auth_file", "service_tier"];
  const head = toml.split(/^\s*\[/m)[0];
  for (const key of FLAT) {
    const m = head.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, "m"));
    if (m) {
      argv.push("-c", `${key}="${m[1]}"`);
      if (key === "model") model = m[1];
    }
  }
  const envSection = toml.match(/^\s*\[env\]\s*\n([\s\S]*?)(?=^\s*\[|$)/m);
  if (envSection) {
    for (const m of envSection[1].matchAll(/^\s*([A-Z0-9_]+)\s*=\s*"([^"]*)"/gm)) {
      env[m[1]] = m[2];
    }
  }
  return { argv, env, model };
}
