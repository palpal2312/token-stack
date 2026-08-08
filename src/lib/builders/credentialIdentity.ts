// Which account a profile actually bills — the identity used to dedupe quota
// probes and to label profiles that share one account.
//
// Kimi rotates access tokens per session, so two profiles of one account hold
// DIFFERENT tokens — but every token is a JWT whose `sub` is the account.
// Decoding the payload (no signature check — this is grouping, not
// authentication) is the only honest identity; the token hash stays as the
// fallback for non-JWTs.

import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import type { Builder } from "./registry";

type IdentityCarrier = Pick<Builder, "cli" | "auth" | "args">;

export function credentialIdentity(b: IdentityCarrier): string | null {
  // "none" (shared login) and "oauth" (own home) both resolve to a real home;
  // the default home covers the shared-login profile.
  if (b.cli !== "kimi" && b.cli !== "codex") return null;
  if (b.auth.kind !== "oauth" && b.auth.kind !== "none") return null;
  // A codex `-p <name>` profile with a CUSTOM PROVIDER bills that provider,
  // NOT the login in auth.json (fugu → Sakana). But a -p whose config only
  // tweaks features/projects has no provider of its own — it bills the
  // default account like any plain codex profile, and must group with it.
  if (b.cli === "codex") {
    const pIdx = (b.args ?? []).indexOf("-p");
    const profileName = pIdx >= 0 ? b.args[pIdx + 1] : null;
    if (profileName) {
      const pHome = b.auth.kind === "oauth" && b.auth.configDir
        ? b.auth.configDir
        : path.join(os.homedir(), ".codex");
      try {
        const toml = readFileSync(path.join(pHome, `${profileName}.config.toml`), "utf8");
        const provider = toml.match(/^\s*model_provider\s*=\s*"([^"]+)"/m)?.[1];
        if (provider) return `codex-p:${provider}`;
      } catch { /* no profile config — falls through to the default account */ }
    }
  }
  const defaultHome = b.cli === "kimi" ? ".kimi-code" : ".codex";
  const credFile = b.cli === "kimi"
    ? path.join("credentials", "kimi-code.json")
    : "auth.json";
  const home = b.auth.kind === "oauth" && b.auth.configDir
    ? b.auth.configDir
    : path.join(os.homedir(), defaultHome);
  try {
    const j = JSON.parse(readFileSync(path.join(home, credFile), "utf8")) as {
      access_token?: string;
      tokens?: { id_token?: string; access_token?: string };
    };
    // codex nests tokens under `tokens`; id_token carries the account as JWT
    // sub even when access_token is opaque. kimi's is flat access_token (JWT).
    const token = j.tokens?.id_token ?? j.tokens?.access_token ?? j.access_token;
    if (!token) return null;
    const parts = token.split(".");
    if (parts.length >= 2) {
      const payload = JSON.parse(
        Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(),
      ) as { sub?: string; user_id?: string; email?: string };
      const id = payload.sub ?? payload.user_id ?? payload.email;
      if (id) return `sub:${id}`;
    }
    return `tok:${createHash("sha256").update(token).digest("hex").slice(0, 16)}`;
  } catch { return null; }
}

/** Other profiles in `all` that share this one's account. */
export function sameAccountSiblings(b: Builder, all: Builder[]): Builder[] {
  const mine = credentialIdentity(b);
  if (!mine) return [];
  return all.filter((o) => o.id !== b.id && credentialIdentity(o) === mine);
}
