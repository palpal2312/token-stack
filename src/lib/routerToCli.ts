// One click from a Router (an HTTP endpoint + a key) to a Builder profile of a
// CLI — the same `codex -p fugu` profile a user would otherwise write by hand.
//
// Two paths, one per mechanism that actually exists:
//
//   - codex: write a native profile into $CODEX_HOME — a `<slug>.config.toml`
//     naming the Router's base URL as a model provider, plus one line in
//     $CODEX_HOME/.env holding the key — then run it through the SAME native
//     detection + import every hand-written profile takes. Agent OS does not
//     register the Builder from its own write; if detection cannot see the
//     file, that is reported, not papered over.
//   - claude: claude has no native profile concept; it isolates per env var.
//     So the Builder is a plain api-key profile whose env points
//     ANTHROPIC_BASE_URL at the Router.
//   - kimi: kimi has no `-p`-style profile flag and no base-URL env override,
//     but it reads providers from <KIMI_CODE_HOME>/config.toml and honors
//     KIMI_CODE_HOME (both verified on this machine — see withKimi). So the
//     Builder is an oauth-kind profile: createBuilder makes a FRESH configDir,
//     and we write a whole config.toml there with an OpenAI-compatible provider
//     pointing at the Router. The user's real ~/.kimi-code is never touched.
//
// Both paths are idempotent: running one twice returns the Builder that
// already exists instead of making a twin, and an existing key line in .env is
// never overwritten.
//
// Key discipline is the same as the registries': key VALUES go into files and
// into Builder secrets, never into the returned detail — that names files and
// env vars only, because it is what the HTTP response shows.

import { readFile, writeFile, appendFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { getRouter, type Router } from "./routers/registry";
import {
  createBuilder, createNativeImport, listBuilders, slugify, NativeImportExists,
  type Builder,
} from "./builders/registry";
import { detectNativeProfiles } from "./builders/nativeProfiles";

export interface UseWithCliResult {
  builder: Builder;
  /** False when the matching Builder already existed and nothing was written. */
  created: boolean;
  /** What was written, for display. Paths and env var NAMES — never key values. */
  detail: string[];
}

// Lazy, like nativeProfiles.ts: QA redirects CODEX_HOME per server run, and a
// constant captured at import time would freeze whatever the process first saw.
function codexHome(): string {
  return process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
}

/** Minimal TOML basic-string escape — enough for names and URLs we write. */
function tomlStr(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export async function useRouterWithCli(routerId: string, cli: string, name?: string): Promise<UseWithCliResult> {
  const router = await getRouter(routerId);
  if (!router) throw new Error(`No Router "${routerId}".`);
  if (cli === "codex") return withCodex(router, name);
  if (cli === "claude") return withClaude(router);
  if (cli === "kimi") return withKimi(router, name);
  throw new Error(`Use with CLI does not support "${cli}" yet (supported: codex, claude, kimi).`);
}

// --------------------------------------------------------------------- codex

async function withCodex(router: Router, name?: string): Promise<UseWithCliResult> {
  const base = slugify((name ?? "").trim() || router.name);
  if (!base) {
    throw new Error("That name leaves nothing a profile file could be called — give it a few letters or digits.");
  }
  const slug = `ao-${base}`;
  const envKey = `AO_ROUTER_${slug.toUpperCase().replace(/-/g, "_")}_KEY`;
  const args = ["-p", slug];

  // Idempotency is decided by the Builder, not the files: if a Builder already
  // runs `codex -p <slug>`, the profile is already wired in and re-writing
  // files would only risk touching a key line the user may have rotated.
  const existing = (await listBuilders()).find(
    (b) => b.cli === "codex" && b.args.length === 2 && b.args[0] === "-p" && b.args[1] === slug,
  );
  if (existing) {
    return {
      builder: existing, created: false,
      detail: [
        `Builder "${existing.name}" already runs codex -p ${slug} — nothing was written.`,
        `The key still comes from ${envKey} in ${path.join(codexHome(), ".env")}.`,
      ],
    };
  }

  const home = codexHome();
  await mkdir(home, { recursive: true });
  const detail: string[] = [];

  const configFile = path.join(home, `${slug}.config.toml`);
  const modelLine = router.defaultModel ? `model = "${tomlStr(router.defaultModel)}"\n` : "";
  const toml =
    `# Written by Agent OS "Use with CLI" from Router "${tomlStr(router.name)}".\n`
    + `# Run it with: codex -p ${slug}\n`
    + modelLine
    + `model_provider = "${slug}"\n`
    + `\n`
    + `[model_providers.${slug}]\n`
    + `name = "${tomlStr(router.name)}"\n`
    + `base_url = "${tomlStr(router.baseUrl)}"\n`
    + `env_key = "${envKey}"\n`
    + `# "chat" is the OpenAI-compatible /chat/completions wire every Router speaks.\n`
    + `# Use "responses" only for endpoints that support the Responses API.\n`
    + `wire_api = "chat"\n`;
  await writeFile(configFile, toml, "utf8");
  detail.push(`Wrote ${configFile} (provider "${slug}", wire_api "chat").`);

  const envFile = path.join(home, ".env");
  if (router.apiKey) {
    const prior = existsSync(envFile) ? await readFile(envFile, "utf8") : "";
    if (new RegExp(`^\\s*${envKey}\\s*=`, "m").test(prior)) {
      // A key under this name is already there — possibly rotated by hand.
      // Overwriting it would quietly re-point the profile at the old account.
      detail.push(`${envKey} was already in ${envFile} — left untouched.`);
    } else {
      await appendFile(envFile, `${prior && !prior.endsWith("\n") ? "\n" : ""}${envKey}=${router.apiKey}\n`, "utf8");
      detail.push(`Appended ${envKey} to ${envFile}.`);
    }
  } else {
    detail.push(`The Router carries no key, so nothing was added to ${envFile} — the endpoint answers without one.`);
  }

  // The profile goes through detection like any hand-written one. If codex's
  // own mechanism changes and detection stops seeing these files, this throws
  // instead of importing something codex would not run.
  const found = detectNativeProfiles().find((p) => p.cli === "codex" && p.name === slug);
  if (!found) {
    throw new Error(`Wrote ${configFile}, but codex profile detection did not see it — the CLI's native profile mechanism may have changed.`);
  }

  let builder: Builder;
  try {
    builder = await createNativeImport({
      cli: "codex", profileName: found.name, args: found.args, source: found.source, provider: found.provider,
    });
  } catch (e) {
    if (!(e instanceof NativeImportExists)) throw e;
    // Another writer got there first; the dedupe-by-args Builder IS the answer.
    const twin = (await listBuilders()).find(
      (b) => b.cli === "codex" && b.args.length === 2 && b.args[0] === "-p" && b.args[1] === slug,
    );
    if (!twin) throw e;
    builder = twin;
  }
  detail.push(`Imported as Builder "${builder.name}" — runs codex ${args.join(" ")}.`);
  return { builder, created: true, detail };
}

// -------------------------------------------------------------------- claude

async function withClaude(router: Router): Promise<UseWithCliResult> {
  if (!router.apiKey) {
    throw new Error(`Router "${router.name}" carries no key, and a claude profile needs one for ANTHROPIC_API_KEY.`);
  }

  // Idempotent on (cli, base URL): a second click for the same endpoint returns
  // the profile already pointing at it, whatever either one is named.
  const existing = (await listBuilders()).find(
    (b) => b.cli === "claude" && b.auth.kind === "api" && b.env?.ANTHROPIC_BASE_URL === router.baseUrl,
  );
  if (existing) {
    return {
      builder: existing, created: false,
      detail: [
        `Builder "${existing.name}" already points claude at ${router.baseUrl} — nothing was written.`,
      ],
    };
  }

  const builder = await createBuilder({
    cli: "claude",
    name: `Claude — ${router.name}`,
    authKind: "api",
    secrets: { ANTHROPIC_API_KEY: router.apiKey },
    env: { ANTHROPIC_BASE_URL: router.baseUrl },
    notes: `Made from Router "${router.name}" (id ${router.id}) via Use with CLI. The key is a copy of the Router's — rotating one does not rotate the other.`,
  });
  return {
    builder, created: true,
    detail: [
      `Created Builder "${builder.name}" — claude runs with ANTHROPIC_BASE_URL=${router.baseUrl} and the Router's key as ANTHROPIC_API_KEY.`,
    ],
  };
}

// ---------------------------------------------------------------------- kimi

// Mechanism, verified on this machine 2026-07-28 against a scratch
// KIMI_CODE_HOME (`kimi doctor config` + `kimi provider list`): a custom
// OpenAI-compatible provider is plain TOML in <KIMI_CODE_HOME>/config.toml —
//
//   [providers."<id>"]            type = "openai", base_url, api_key (optional)
//   [models."<id>/<alias>"]       provider, model, max_context_size (REQUIRED —
//                                 doctor rejects the model without it)
//   default_model = "<id>/<alias>"
//
// KIMI_CODE_HOME itself was verified 2026-07-27 (clis/kimi.ts notes). Kimi has
// no `-p`-style profile flag and no base-URL env var, so the env-scoped fallback
// the claude branch uses does not exist — the profile is an oauth-kind Builder
// whose fresh configDir gets the whole config.toml. ("oauth" here only means
// "isolated KIMI_CODE_HOME"; no OAuth flow is involved.)
async function withKimi(router: Router, name?: string): Promise<UseWithCliResult> {
  if (!router.defaultModel) {
    throw new Error(`Router "${router.name}" has no default model, and a kimi profile needs one — the model alias in config.toml is the only thing kimi knows to ask the endpoint for.`);
  }

  // Idempotent on (cli, base URL), like claude: a second click for the same
  // endpoint returns the profile already pointing at it. The marker is the
  // base_url line inside the profile's own config.toml — re-writing it would
  // only risk clobbering a key the user rotated by hand.
  for (const b of await listBuilders()) {
    if (b.cli !== "kimi" || b.auth.kind !== "oauth" || !b.auth.configDir) continue;
    const cfg = path.join(b.auth.configDir, "config.toml");
    if (!existsSync(cfg)) continue;
    const text = await readFile(cfg, "utf8").catch(() => "");
    if (text.includes(`base_url = "${tomlStr(router.baseUrl)}"`)) {
      return {
        builder: b, created: false,
        detail: [`Builder "${b.name}" already points kimi at ${router.baseUrl} — nothing was written.`],
      };
    }
  }

  const builder = await createBuilder({
    cli: "kimi",
    name: `Kimi — ${(name ?? "").trim() || router.name}`,
    authKind: "oauth",
    notes: `Made from Router "${router.name}" (id ${router.id}) via Use with CLI. The key sits in this profile's own config.toml — rotating the Router's key does not rotate it.`,
  });
  const configDir = builder.auth.configDir!; // oauth-kind creation always makes one

  const providerId = `ao-${slugify(router.name) || "router"}`;
  const alias = `${providerId}/default`;
  const keyLine = router.apiKey ? `api_key = "${tomlStr(router.apiKey)}"\n` : "";
  const toml =
    `# Written by Agent OS "Use with CLI" from Router "${tomlStr(router.name)}".\n`
    + `# This whole directory is the profile's KIMI_CODE_HOME; edit freely.\n`
    + `default_model = "${tomlStr(alias)}"\n`
    + `\n`
    + `[providers."${providerId}"]\n`
    + `type = "openai"\n`
    + `base_url = "${tomlStr(router.baseUrl)}"\n`
    + keyLine
    + `\n`
    + `[models."${tomlStr(alias)}"]\n`
    + `provider = "${providerId}"\n`
    + `model = "${tomlStr(router.defaultModel)}"\n`
    + `# Conservative context size — raise it to what the endpoint actually serves.\n`
    + `max_context_size = 131072\n`
    + `capabilities = [ "tool_use" ]\n`;
  const configFile = path.join(configDir, "config.toml");
  await writeFile(configFile, toml, "utf8");

  const detail = [
    `Created Builder "${builder.name}" — kimi runs with KIMI_CODE_HOME=${configDir}.`,
    `Wrote ${configFile} (provider "${providerId}", type "openai", default model "${alias}").`,
  ];
  if (!router.apiKey) {
    detail.push("The Router carries no key, so the provider has no api_key line — the endpoint answers without one.");
  }
  return { builder, created: true, detail };
}
