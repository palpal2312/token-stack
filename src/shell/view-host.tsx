"use client";

import { Component, Suspense, use, useRef, type ErrorInfo, type ReactNode } from "react";
import { findModuleByRoute } from "./desktop-module-registry";

/**
 * ViewHost (Phase 19a U1).
 *
 * Swaps feature content WITHOUT recreating the global providers/stores — those
 * live above in `DesktopShell`, which stays mounted. The host only bounds the
 * feature region: a region-scoped error boundary and a region Suspense
 * placeholder sit around the module content, never around the whole shell, so
 * the sidebar/header stay interactive while a region loads or fails.
 *
 * Stage 1 reads the active module from the registry (`findModuleByRoute`) and
 * renders the existing feature route as children; the boundary is keyed by the
 * module id so switching modules resets only the region, not the shell.
 */

/** Plain inequitable-by-construction region error boundary (covers a region only). */
export class RegionErrorBoundary extends Component<
  { children: ReactNode; moduleId: string; onReset?: () => void },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // The rest of the shell stays usable; surface the failure for diagnostics.
    console.error(`view region "${this.props.moduleId}" failed`, error, info);
  }

  private reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-[40vh] items-center justify-center p-8" role="alert">
        <div className="panel max-w-md p-6 text-sm">
          <div className="mb-1 text-[13px] font-semibold">This region failed to load</div>
          <div className="mb-3 text-[var(--fg-dim)]">
            The shell around it is still usable. Try again or reload the page.
          </div>
          <button
            type="button"
            onClick={this.reset}
            className="rounded-lg border border-[var(--panel-border)] px-3 py-1.5 text-[12px] transition hover:border-[var(--panel-border-hot)]"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }
}

function RegionSkeleton() {
  return (
    <div role="status" className="flex h-full min-h-[40vh] flex-col gap-3 p-4">
      <span className="sr-only">Loading region</span>
      <div className="h-4 w-40 rounded bg-white/5 animate-pulse" />
      <div className="flex-1 rounded-lg border border-[var(--line-soft)] bg-white/[0.03] animate-pulse" />
    </div>
  );
}

/**
 * One shell region: its own Suspense skeleton + region error boundary, keyed by
 * an independent identity so a slow or failing region never tears down the
 * sidebar/header or a sibling region.
 */
export function Region({ moduleId, children }: { moduleId: string; children: ReactNode }) {
  return (
    <RegionErrorBoundary moduleId={moduleId}>
      <Suspense fallback={<RegionSkeleton />}>{children}</Suspense>
    </RegionErrorBoundary>
  );
}

/**
 * One independent region read. `read` is the async data source for the region;
 * it is called exactly once per region render (see `startIndependentReads`).
 */
export interface RegionRead {
  key: string;
  read: () => Promise<ReactNode>;
}

/**
 * Pure fan-out for independent reads: kicks every read in the same tick (no
 * sequential waterfall) and exposes both the per-read promise (to drive a
 * Suspense boundary) and an aggregate Promise.allSettled (to observe or gate on
 * all regions settling).
 */
export function startIndependentReads(
  reads: readonly { key: string; read: () => Promise<unknown> }[],
): { promises: ReadonlyMap<string, Promise<unknown>>; settled: Promise<readonly PromiseSettledResult<unknown>[]> } {
  const started = reads.map((r) => [r.key, r.read()] as const);
  return {
    promises: new Map(started),
    settled: Promise.allSettled(started.map(([, p]) => p)),
  };
}

/** Renders a read's resolved content, suspending / throwing through the boundary. */
function RegionBody({ promise }: { promise: Promise<ReactNode> }) {
  return use(promise);
}

/**
 * Host multiple INDEPENDENT shell regions in parallel. All reads start in the
 * same tick (no waterfall); each region owns its Suspense skeleton +
 * RegionErrorBoundary, so a slow region streams behind a stable skeleton while
 * faster regions commit first, and a failing region renders only its own
 * fallback while siblings stay mounted. Fake-async-source testable without a
 * network.
 */
export function ParallelRegions({ regions }: { regions: readonly RegionRead[] }) {
  // Start every independent read exactly once per regions-array identity (React
  // resume re-renders must not re-run a read — no double fetch). All reads are
  // kicked in the same tick, before any region body renders, so they are
  // concurrent rather than chained on one another.
  const firstRender = useRef<{ regions: readonly RegionRead[]; reads: { key: string; promise: Promise<ReactNode> }[] } | null>(null);
  if (firstRender.current === null || firstRender.current.regions !== regions) {
    firstRender.current = { regions, reads: regions.map((r) => ({ key: r.key, promise: r.read() })) };
  }
  const reads = firstRender.current.reads;
  return (
    <>
      {reads.map(({ key, promise }) => (
        <Region key={key} moduleId={key}>
          <RegionBody promise={promise} />
        </Region>
      ))}
    </>
  );
}

export function ViewHost({ route, children }: { route: string; children: ReactNode }) {
  const module = findModuleByRoute(route);
  // Key the region boundary by the owning module so switching features resets
  // only this region; unknown routes fall back to the route itself.
  const key = (module?.id ?? route.replace(/^\//, "").replace(/\//g, "_")) || "root";
  return <Region moduleId={key}>{children}</Region>;
}