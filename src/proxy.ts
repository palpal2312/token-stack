// Next 16 "proxy" (the renamed middleware — always runs on the Node.js
// runtime here, so reading the token file is fine).
//
// Hands the API token to the browser as an HttpOnly session cookie on every
// page navigation. This replaces the old inline bootstrap script that put the
// token on window and monkey-patched fetch/EventSource: the token now never
// enters window scope, a URL, the history, or a log line. Same-origin fetch,
// EventSource, and WebSocket all send the cookie automatically, so client
// code needs no auth handling at all.
//
// Non-browser callers are unaffected — they authenticate with the
// x-agentic-os-token header (lib/apiToken.ts) and never receive this cookie.
//
// The cookie is re-set on every navigation (not only when missing) so a
// rotated token (rotateApiToken) reaches open tabs on their next load.
// No Secure flag: the dashboard is plain http on 127.0.0.1 and a Secure
// cookie would be dropped. SameSite=Strict keeps it off cross-site requests.

import { NextResponse, type NextRequest } from "next/server";
import { getApiToken } from "@/lib/apiToken";
import { SESSION_COOKIE } from "@/lib/sessionCookie";

export function proxy(_req: NextRequest): NextResponse {
  const res = NextResponse.next();
  res.cookies.set(SESSION_COOKIE, getApiToken(), {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
  });
  return res;
}

export const config = {
  // Page navigations only — API routes, _next assets, and files (favicon,
  // icons) neither need nor should receive the session cookie.
  // Known caveat: the `.*\..*` exclusion skips dotted PAGE urls too (e.g. an
  // id containing a "."). Impact is limited to cold deep-links to such pages,
  // because the cookie persists across navigations (path=/, session lifetime)
  // and any prior navigation already set it.
  matcher: ["/((?!api/|_next/|.*\\..*).*)"],
};
