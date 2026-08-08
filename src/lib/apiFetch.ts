"use client";

// Client-side helpers for talking to the dashboard API.
//
// Auth is the HttpOnly `agentic_os_session` cookie, set by src/proxy.ts on
// every page load — JavaScript never sees the API token. Same-origin fetch
// (credentials default to "same-origin"), EventSource, and WebSocket all send
// cookies automatically, so these helpers only build URLs; they carry no
// credentials themselves. Non-browser callers (curl, the QA suite, CLI
// agents) authenticate with the x-agentic-os-token header instead
// (lib/apiToken.ts).

export function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  return fetch(input, init);
}

/** Same-origin EventSource URL — the session cookie rides along automatically. */
export function apiStreamUrl(path: string): string {
  return path;
}

/** Same-origin WebSocket URL — the upgrade request carries the session cookie. */
export function apiWsUrl(path: string): string {
  const proto = typeof window !== "undefined" && window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = typeof window !== "undefined" ? window.location.host : "127.0.0.1:3737";
  return `${proto}//${host}${path}`;
}
