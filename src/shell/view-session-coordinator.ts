/**
 * View session coordinator (Phase 19a U1).
 *
 * Single-writer reconciliation between the active ViewSession and the app
 * router URL. The router URL is a PROJECTION of the active session and uses
 * replace-style reconciliation — it is NOT a second history authority
 * (Phase 19a "Persistent shell and panel state machine": the app router is a
 * projection of the active session and uses replace-style reconciliation
 * rather than a second history authority).
 *
 * Two directions, both guarded against feedback loops:
 *   - store → router: the active tab's url replaces the router URL.
 *   - router → store: external/normalized route changes reconcile into the
 *     store via semantic tab open. A change that matches what we just projected
 *     is our own echo and is ignored (loop guard).
 *
 * Pure (no React, no Next.js, no DOM); the integration stage injects the router
 * `replace` and `getCurrentUrl`. This module never adds history entries.
 */

import type { ViewSessionStore, ViewRoute } from "./view-session-store";
import { normalizeRouteUrl, routePathname } from "./view-session-store";

/** Resolve a normalized url to a module descriptor the store can open. */
export type RouteResolver = (url: string) => ViewRoute | null;

export interface ViewSessionCoordinatorOptions {
  store: ViewSessionStore;
  /** Replace-style projection target (integration supplies `router.replace`). */
  replace(url: string): void;
  /** Read the current router url (integration supplies location/next/router). */
  getCurrentUrl(): string;
  /** Maps a normalized url to its module; null → route not claimed by the shell. */
  resolveRoute?: RouteResolver;
}

export type RouteChangeReason = "applied" | "self-echo" | "unknown-route" | "no-change";

export interface RouteChangeResult {
  applied: boolean;
  url: string;
  reason: RouteChangeReason;
}

export interface ViewSessionCoordinator {
  /**
   * The active session changed (or the caller wants the router to mirror it):
   * replaces the router URL with the active tab's url. Returns the projected
   * url, or null when it was already in sync.
   */
  notifyStoreChanged(): string | null;
  /**
   * An incoming router URL change: normalizes it and reconciles into the store.
   * A change that equals the last projected url is our own replace-echo and is
   * ignored (loop guard). Unknown routes are not claimed by the shell.
   */
  handleRouteChange(rawUrl: string): RouteChangeResult;
}

const samePath = (a: string, b: string): boolean => routePathname(a) === routePathname(b);

export function createViewSessionCoordinator(
  options: ViewSessionCoordinatorOptions,
): ViewSessionCoordinator {
  const { store, replace, resolveRoute } = options;
  let lastProjectedUrl: string | null = null;

  return {
    notifyStoreChanged() {
      const url = normalizeRouteUrl(store.activeTab().url);
      // In sync — nothing to project. Avoids echoing the same replace repeatedly.
      if (lastProjectedUrl !== null && samePath(lastProjectedUrl, url)) return null;
      replace(url);
      lastProjectedUrl = url;
      return url;
    },
    handleRouteChange(rawUrl: string): RouteChangeResult {
      const url = normalizeRouteUrl(rawUrl);

      // Loop guard: this equals what we just projected → it's our own echo.
      if (lastProjectedUrl !== null && samePath(lastProjectedUrl, url)) {
        return { applied: false, url, reason: "self-echo" };
      }

      // Not a claim of the shell's session authority → leave the app router alone.
      if (resolveRoute) {
        const route = resolveRoute(url);
        if (route) {
          store.open(route);
          lastProjectedUrl = url;
          return { applied: true, url, reason: "applied" };
        }
        return { applied: false, url, reason: "unknown-route" };
      }

      // No resolver wired: still normalize the active session against the route
      // only when the active tab doesn't already own this url.
      store.open({ moduleId: "path", url, titleToken: routePathname(url) });
      lastProjectedUrl = url;
      return { applied: true, url, reason: "applied" };
    },
  };
}