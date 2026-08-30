/**
 * Module prefetch data seam (Phase 19a U1, intent prefetch).
 *
 * The data side of an intent prefetch: given a module id, resolve the canonical
 * cache key it fills and the endpoint that provides its data, and run the read.
 * `runModuleDataPrefetch` is the (b) half of a hover's prefetch — it issues the
 * module's data query. It is pure and injects `fetch`, so it is unit-testable
 * under node:test with a fake fetch (no network).
 *
 * The lazy-chunk half ((a)) stays with the module's `load()` in the registry;
 * the registry itself remains pure (no DOM/Next imports).
 *
 * Only modules with real, canonical data prefetch here; aux/settings modules
 * resolve to `null` (chunk preload still runs via the registry `load`).
 */

import { queryKeys, type QueryKey } from "./query-keys";

/** Minimal fetch signature the seam needs (browser fetch shape). */
export type FetchLike = (url: string, init?: RequestInit) => Promise<unknown>;

export interface ModuleDataPrefetchSpec {
  moduleId: string;
  /** Addressable cache key this prefetch would fill (scope-aware). */
  key: QueryKey;
  /** Endpoint the prefetch issues. */
  url: string;
}

/** Endpoints whose data a module's intent prefetch warms. */
const modulePrefetchTable: Readonly<
  Record<string, (workspaceId: string) => Pick<ModuleDataPrefetchSpec, "key" | "url">>
> = {
  sen: (ws) => ({ key: queryKeys.sessions.active(ws), url: "/api/sen" }),
  "agent-kanban": (ws) => ({ key: queryKeys.kanban.list(ws), url: "/api/agent-kanban/cards?summary=1" }),
  kanban: (ws) => ({ key: queryKeys.kanban.list(ws), url: "/api/agent-kanban/cards?summary=1" }),
  "code-space": (ws) => ({ key: queryKeys.runtime.snapshot(ws), url: "/api/herdr/snapshot?summary=1" }),
};

/**
 * Resolve the data prefetch for a module (scope-aware). `null` for modules
 * without a canonical data read — their chunk preload still runs.
 */
export function resolveModuleDataPrefetch(
  moduleId: string,
  workspaceId: string,
): ModuleDataPrefetchSpec | null {
  const build = modulePrefetchTable[moduleId];
  if (!build) return null;
  const { key, url } = build(workspaceId);
  return { moduleId, key, url };
}

/**
 * Run a module's data prefetch. No-op (resolves to null) for modules without a
 * data read; otherwise issues the prefetch query through the injected fetch.
 */
export function runModuleDataPrefetch(
  moduleId: string,
  deps: { workspaceId: string; fetch: FetchLike },
): Promise<unknown> {
  const spec = resolveModuleDataPrefetch(moduleId, deps.workspaceId);
  if (!spec) return Promise.resolve(null);
  return deps.fetch(spec.url);
}