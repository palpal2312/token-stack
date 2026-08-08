// Origin guard for routes that write credentials or execute binaries.
//
// The dashboard listens on 127.0.0.1 with no login, which is fine for reading
// your own data — but it is NOT a trust boundary. `req.json()` happily parses a
// text/plain body, and a text/plain POST is a "simple request": any web page you
// have open can send one cross-origin, with no preflight to stop it. Without a
// check, a page could create a Builder pointing at an arbitrary executable and
// then ask a chat route to run it, or repoint a router at its own host and
// collect the API key the health probe sends.
//
// So: mutating routes require a same-origin request, a real JSON content type,
// AND the per-install API token (lib/apiToken.ts — the openworker sidecar
// model). The origin check stops cross-origin pages; it cannot stop a local
// process, which sends no Origin at all — the token can. A *present* Origin
// must still be ours.
//
// Non-browser callers (curl, the QA suite, CLI agents) authenticate by reading
// the token from ~/.agentic-os/api-token and sending it as the
// `x-agentic-os-token` header. The browser never sees the token at all: it
// authenticates with the HttpOnly `agentic_os_session` cookie set by
// src/proxy.ts (lib/sessionCookie.ts), so the token stays out of window scope,
// URLs, logs, and history. Query-string tokens are rejected unless a route
// explicitly opts back in with `allowQueryToken: true` — none should.

import { API_TOKEN_HEADER, verifyApiToken } from "./apiToken";
import { readSessionCookie } from "./sessionCookie";

const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function hostAllowed(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    return ALLOWED_HOSTS.has(u.hostname) || ALLOWED_HOSTS.has(`[${u.hostname}]`);
  } catch { return false; }
}

export type GuardFailureKind = "foreign_origin" | "missing_token" | "unsupported_media_type";

// Severity follows the phase-20 release-gate vocabulary (critical/high/
// medium/low) so a guard failure maps into gate findings without
// re-interpretation: an active cross-origin forgery attempt is high, an
// unauthenticated call is medium (benign misconfiguration or probing), a
// wrong content type is low.
export type GuardFailureSeverity = "critical" | "high" | "medium" | "low";

export interface GuardFailure {
  error: string;
  status: 401 | 403 | 415;
  kind: GuardFailureKind;
  severity: GuardFailureSeverity;
}

/**
 * Returns null when the request may proceed, or the reason it may not.
 * `requireJson` is on for verbs with a body; a GET guard only checks origin
 * and token. `allowQueryToken` defaults to false — a token in the query
 * string is rejected unless a route explicitly opts in (none should; a token
 * in a URL leaks into logs, history, and Referer headers).
 */
export function checkLocalRequest(
  req: Request,
  opts: { requireJson?: boolean; allowQueryToken?: boolean } = {},
): GuardFailure | null {
  const origin = req.headers.get("origin");
  if (origin && !hostAllowed(origin)) {
    return { status: 403, kind: "foreign_origin", severity: "high", error: `Refused: this endpoint only answers the local dashboard, not ${origin}.` };
  }

  // A cross-site form or fetch can forge Referer far less freely than Origin is
  // omitted, so treat a foreign Referer as hostile too when Origin is absent.
  const referer = req.headers.get("referer");
  if (!origin && referer && !hostAllowed(referer)) {
    return { status: 403, kind: "foreign_origin", severity: "high", error: "Refused: this endpoint only answers the local dashboard." };
  }

  // Token: required on every guarded route, browser or not — a local process
  // is exactly the caller the origin check cannot see. Accepted channels:
  //   1. x-agentic-os-token header  — non-browser callers (curl, QA, CLIs)
  //   2. agentic_os_session cookie  — the browser dashboard (HttpOnly; set by
  //      src/proxy.ts on page loads, sent automatically by fetch/EventSource/
  //      WebSocket)
  // A ?token= query param is NOT accepted by default: a token in a URL lands
  // in logs, browser history, and Referer headers. The channel survives only
  // as an explicit per-route opt-in (allowQueryToken: true); no route uses it.
  const presented = req.headers.get(API_TOKEN_HEADER)
    ?? readSessionCookie(req.headers.get("cookie"))
    ?? (req.method === "GET" && opts.allowQueryToken === true
      ? new URL(req.url).searchParams.get("token")
      : null);
  if (!verifyApiToken(presented)) {
    return {
      status: 401,
      kind: "missing_token",
      severity: "medium",
      error: "This endpoint requires the dashboard API token. The browser "
        + "dashboard sends it as the agentic_os_session cookie; non-browser "
        + "callers send the x-agentic-os-token header, read from "
        + "~/.agentic-os/api-token (or $AGENTIC_OS_HOME/api-token).",
    };
  }

  if (opts.requireJson !== false) {
    const ct = req.headers.get("content-type") ?? "";
    if (!ct.toLowerCase().includes("application/json")) {
      // text/plain is what a cross-origin attacker is limited to; requiring JSON
      // means a forged request needs a preflight, which same-origin policy denies.
      return { status: 415, kind: "unsupported_media_type", severity: "low", error: "Send this request as application/json." };
    }
  }
  return null;
}
