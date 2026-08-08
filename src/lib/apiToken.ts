// Per-install API token for the localhost dashboard (openworker sidecar-token
// model, capability-map §1.3).
//
// The origin guard in localOnly.ts stops cross-origin web pages, but it cannot
// stop a *local* process — any program running on this machine can POST to
// 127.0.0.1 with no Origin header at all. The token closes that: every guarded
// route requires the token, which lives in a user-only file only processes
// running as you can read.
//
// Bootstrap-safe by construction: the first read after an upgrade finds no
// file and mints one, so nothing is ever locked out — the server itself is the
// only writer, and every legitimate non-browser caller (curl, the QA suite,
// CLI agents) reads the same file:
//
//   ~/.agentic-os/api-token          (or $AGENTIC_OS_HOME/api-token)
//
// Synchronous on purpose: checkLocalRequest is called synchronously by ~150
// route handlers, and the value is cached after the first read.

import { readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { AGENTIC_HOME } from "./builders/registry";

export const API_TOKEN_FILE = path.join(AGENTIC_HOME, "api-token");
export const API_TOKEN_HEADER = "x-agentic-os-token";

let cached: string | null = null;

/**
 * Read the token from disk, minting it on first use (32 random bytes, hex,
 * file mode 0600 — best-effort on Windows, where the mode is advisory).
 */
export function getApiToken(): string {
  if (cached) return cached;
  try {
    const t = readFileSync(API_TOKEN_FILE, "utf8").trim();
    if (/^[0-9a-f]{64}$/.test(t)) { cached = t; return t; }
    // A malformed file is replaced, not trusted: it grants nothing either way,
    // and a fresh token is recoverable while a guessable one is not.
  } catch { /* missing → mint below */ }
  mkdirSync(AGENTIC_HOME, { recursive: true });
  const token = randomBytes(32).toString("hex");
  writeFileSync(API_TOKEN_FILE, token + "\n", { mode: 0o600 });
  try { chmodSync(API_TOKEN_FILE, 0o600); } catch { /* Windows: mode is advisory */ }
  cached = token;
  return token;
}

/** Constant-time comparison against the minted token. */
export function verifyApiToken(presented: string | null | undefined): boolean {
  if (!presented) return false;
  const expected = Buffer.from(getApiToken(), "utf8");
  const got = Buffer.from(presented.trim(), "utf8");
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/**
 * Mint a fresh token, persist it (mode 0600, best-effort on Windows), and
 * replace the in-process cache. Use after a suspected leak: every outstanding
 * session cookie and saved header stops working immediately; the dashboard
 * picks the new token up on the next page load (src/proxy.ts re-sets the
 * cookie), and non-browser callers re-read the same file. No HTTP endpoint
 * wraps this on purpose — call it from a CLI or local script.
 */
export function rotateApiToken(): string {
  mkdirSync(AGENTIC_HOME, { recursive: true });
  const token = randomBytes(32).toString("hex");
  writeFileSync(API_TOKEN_FILE, token + "\n", { mode: 0o600 });
  try { chmodSync(API_TOKEN_FILE, 0o600); } catch { /* Windows: mode is advisory */ }
  cached = token;
  return token;
}
