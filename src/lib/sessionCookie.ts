// The browser's auth channel for the dashboard: an HttpOnly cookie holding
// the per-install API token (lib/apiToken.ts), set by src/proxy.ts on every
// page navigation. HttpOnly means the token never enters window scope, a URL,
// the history, or a log line — closing the ?token= / inline-script channels
// the security baseline removed. SameSite=Strict keeps it off cross-site
// requests; no Secure flag because the dashboard is plain http on loopback.
//
// Non-browser callers never see this cookie — they keep authenticating with
// the x-agentic-os-token header instead.

export const SESSION_COOKIE = "agentic_os_session";

/**
 * Extract the session cookie value from a raw Cookie header. Used by the two
 * places that authenticate outside the Next cookie helpers: checkLocalRequest
 * (reads a Fetch Request) and the Herdr terminal WS upgrade (reads an
 * IncomingMessage).
 */
export function readSessionCookie(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE) {
      const value = part.slice(eq + 1).trim();
      return value === "" ? null : value;
    }
  }
  return null;
}
