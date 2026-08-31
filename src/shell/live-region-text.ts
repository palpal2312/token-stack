/**
 * Live-region text mapping (Phase 19a U6 a11y).
 *
 * Pure mapping from UI state to the polite live-region announcement a screen
 * reader should speak for two correct-but-invisible updates:
 *
 *   1. Navigation started / arrived — the route swap itself has no inherent
 *      text a screen reader announces, but a keyboard-only user must know the
 *      view is loading and that it landed.
 *   2. (Send-ack content is already user-facing note text; it needs only the
 *      `aria-live` host, which the SEN view owns.)
 *
 * No React, no DOM, no locale — deterministic and unit-testable. The host
 * component (NavigationProgress) invokes these on the state transitions where
 * announcement is warranted, and only then, so a settled view is never
 * re-announced on every render.
 */

/** The nav phase a live region should announce. */
export type NavProgressPhrase = "start" | "arrived";

/**
 * Turn a route href into a human label: "/agent-kanban" → "Agent Kanban".
 * The shell's default path ("/") reads as "Home".
 */
export function routeLabel(href: string): string {
  if (!href || href === "/") return "Home";
  return href
    .replace(/^\/+|\/+$/g, "")
    .replace(/[/-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Polite announcement text for a nav start / arrival at `href`. */
export function navProgressLiveText(step: NavProgressPhrase, href: string): string {
  const label = routeLabel(href);
  return step === "start" ? `Loading ${label}` : `Arrived at ${label}`;
}