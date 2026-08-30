// Compatibility proxy from the dashboard's Next.js routes to the canonical Go
// control plane (sen-api). The dashboard keeps its route shapes stable while
// reads/writes forward to the Go listener when it is configured and reachable.
//
// Trust model: the Go listener is loopback-only and requires the shared API
// token. The proxy reads `sen.env` from AGENTIC_OS_HOME for the Go token and
// capability nonce — the same file the Go process reads — so both sides agree
// on the credential without duplicating config.
//
// When the Go side is not configured, the proxy reports unavailability so
// callers can keep serving the legacy path during migration.
//
// Config is resolved once and cached for the process lifetime — adding or
// rotating `sen.env` requires a dashboard restart to take effect.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { AGENTIC_HOME } from "./builders/registry";

export interface GoApiConfig {
  baseUrl: string;
  token: string;
  capability: string;
  nonce: string;
}

let cached: GoApiConfig | null | undefined;

function home(): string { return process.env.AGENTIC_OS_HOME ?? AGENTIC_HOME; }

/**
 * Resolve the Go control-plane config from `sen.env`. Returns null when the
 * Go listener is not configured (missing token) — the caller must treat that
 * as "canonical path not available", not as an error worth surfacing.
 */
export async function loadGoApiConfig(): Promise<GoApiConfig | null> {
  if (cached !== undefined) return cached;
  cached = await load();
  return cached;
}

async function load(): Promise<GoApiConfig | null> {
  let body: string;
  try {
    body = await readFile(path.join(home(), "sen.env"), "utf8");
  } catch {
    return null;
  }
  const values: Record<string, string> = {};
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    values[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
  const token = process.env.SEN_API_TOKEN ?? values.SEN_API_TOKEN ?? "";
  if (!token) return null;
  const host = process.env.SEN_API_HOST ?? values.SEN_API_HOST ?? "127.0.0.1";
  // The shared token travels over plaintext HTTP, so the listener must be
  // loopback. A misconfigured host disables the proxy instead of leaking.
  if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(host)) return null;
  const port = process.env.SEN_API_PORT ?? values.SEN_API_PORT ?? "4737";
  return {
    baseUrl: `http://${host}:${port}`,
    token,
    capability: process.env.SEN_REQUIRED_CAPABILITY ?? values.SEN_REQUIRED_CAPABILITY ?? "sen:health",
    nonce: process.env.SEN_CAPABILITY_NONCE ?? values.SEN_CAPABILITY_NONCE ?? "",
  };
}

/** Reset the cached config (tests that change AGENTIC_OS_HOME need this). */
export function resetGoApiConfigCache(): void { cached = undefined; }

/** True when the Go listener is configured. Does not probe reachability. */
export async function goApiAvailable(): Promise<boolean> {
  return (await loadGoApiConfig()) !== null;
}

export interface GoApiResult {
  ok: boolean;
  status: number;
  body: unknown;
  /** Set when the Go listener could not be reached at all. */
  unreachable?: boolean;
}

/**
 * Auth headers for direct calls to the Go daemon (port 3738), which shares
 * the sen-api credential and enforces the same token + capability nonce.
 * Returns no headers when the Go side is not configured: the daemon then
 * fails closed with 401/403, which is the intended posture — never fall back
 * to an unauthenticated request succeeding.
 */
export async function goApiAuthHeaders(): Promise<Record<string, string>> {
  const config = await loadGoApiConfig();
  if (!config) return {};
  return {
    "x-agentic-os-token": config.token,
    "x-agentic-os-capability": config.capability,
    "x-agentic-os-capability-nonce": config.nonce,
  };
}

/** Forward one request to the Go listener with the shared token + nonce. */
export async function goApiFetch(pathname: string, init: { method?: string; body?: unknown; commandId?: string } = {}): Promise<GoApiResult> {
  const config = await loadGoApiConfig();
  if (!config) return { ok: false, status: 503, body: { code: "not_ready", message: "canonical Go API is not configured" }, unreachable: true };
  try {
    const res = await fetch(`${config.baseUrl}${pathname}`, {
      method: init.method ?? "GET",
      headers: {
        "content-type": "application/json",
        "x-agentic-os-token": config.token,
        "x-agentic-os-capability": config.capability,
        "x-agentic-os-capability-nonce": config.nonce,
        // Mutating SEN commands require the command-id header (receipt key).
        ...(init.commandId ? { "x-sen-command-id": init.commandId } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body };
  } catch {
    return { ok: false, status: 503, body: { code: "not_ready", message: "canonical Go API is unreachable" }, unreachable: true };
  }
}
