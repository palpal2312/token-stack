"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";

/**
 * Dynamic shell boundary (budget fix: stops the flag-ON desktop shell graph
 * from bundling statically into the flag-OFF default chunk).
 *
 * DesktopShell and its whole graph (module registry, view-session store +
 * coordinator, sen-surface coordinator + store, panel-layout store,
 * panel-resize, intent-prefetch, query cache + client, ack-seed, settings
 * preview) are declared lazily via `next/dynamic`, so they live in a separate
 * chunk fetched only when the flag is ON. SSR still renders the ON branch.
 * The root layout mounts this boundary instead of DesktopShell directly —
 * flag-OFF, the boundary returns null and the legacy Shell branch renders.
 */

const DesktopShell = dynamic(() => import("./desktop-shell"));

/** Pure gate over the shell flag — extracted so the boundary is unit-testable. */
export function renderDynamicShell(enabled: boolean): boolean {
  return enabled;
}

/**
 * Renders DesktopShell lazily only when `enabled`. Passed server-side resolved
 * rollout flags (a client cannot read env); OFF renders nothing (the root
 * layout's legacy Shell branch handles the default), ON mounts the whole
 * persistent shell graph from its own chunk.
 */
export default function DynamicShell({
  enabled,
  surfaceCoordinatorEnabled,
  fixtureEnabled,
  children,
}: {
  enabled: boolean;
  surfaceCoordinatorEnabled: boolean;
  fixtureEnabled: boolean;
  children: ReactNode;
}) {
  if (!renderDynamicShell(enabled)) return null;
  return (
    <DesktopShell surfaceCoordinatorEnabled={surfaceCoordinatorEnabled} fixtureEnabled={fixtureEnabled}>
      {children}
    </DesktopShell>
  );
}