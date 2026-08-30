/**
 * Query-cache authority (Phase 19a U3) — pure, library-free server-state cache.
 *
 * One NEWS OS query client owns all cached reads of server state. The typed key
 * factories in `query-keys.ts` address the cache (components never hand-build
 * string keys), a single provider binds it per workspace (query-client.tsx), and
 * this module is the engine. It is deliberately framework-free (no React/Next/
 * DOM) so it is unit-testable under node:test via tsx.
 *
 * Capabilities that satisfy the "Query and realtime contract" / "Server cache"
 * rows of phase 19a:
 *   - Bounded cache: per-key scope config carries a stale window, a hard max-age,
 *     and a per-scope entry cap (LRU eviction), plus a global cap.
 *   - Scoped defaults: config is resolved per key factory scope with longest
 *     prefix match; data never crosses workspaces because cache keys embed the
 *     workspace id AND each mounted provider owns one workspace.
 *   - Request coalescing: concurrent reads of the same key share a single
 *     in-flight promise, so N awaited same-key reads produce one network call.
 *   - Refetch-on-stale with backoff: fresh reads serve the cache; stale reads
 *     within the max-age window serve stale data and refetch in the background,
 *     throttled by `retryBackoffMs`; reads older than max-age are hard misses
 *     that evict and fetch.
 *
 * TanStack Query note: phase 19a RECOMMENDS `@tanstack/react-query` as the
 * eventual layer and requires a dependency/license/security review before it is
 * adopted. That review is deferred to a Phase 20 item. This custom engine ships
 * the U3 contract today without the new dependency, and is the same shape a
 * future TanStack migration would wrap.
 */

import { serializeQueryKey, type QueryKey } from "./query-keys";

export type QueryStatus = "pending" | "success" | "error";

export interface QueryCacheEntry<T = unknown> {
  key: QueryKey;
  data: T | undefined;
  status: QueryStatus;
  error: unknown;
  /** Last time data was written/fetched successfully (ms epoch). */
  updatedAt: number;
  /** A fetch is currently in flight for this key (drives pending/coalescing). */
  fetching: boolean;
}

/** Per-key-factory-scope cache configuration. */
export interface QueryKeyScopeConfig {
  /** Data older than this is stale: serve cached value + refetch in background. */
  staleMs: number;
  /** Data older than this is a hard miss: evict and refetch (no stale serve). */
  maxAgeMs: number;
  /** LRU entry cap for keys that resolve to this scope (0 = unlimited). */
  maxEntries: number;
  /** Minimum gap between automatic refetches for a key (backoff). */
  retryBackoffMs: number;
}

export const QUERY_DEFAULTS: Readonly<QueryKeyScopeConfig> = {
  staleMs: 30_000,
  maxAgeMs: 5 * 60_000,
  maxEntries: 200,
  retryBackoffMs: 2_000,
};

/** Hard cap for the whole cache regardless of scope configs. */
export const GLOBAL_MAX_ENTRIES = 1200;

/**
 * Built-in per-factory configs. Registered on construction; callers may override
 * later via `configure`. Scopes are the key-factory portion after the workspace
 * id; `"*"` matches any single dynamic segment (e.g. a session id), so
 * thread-under-session gets its own faster staleness.
 */
export const BUILTIN_QUERY_CONFIGS: ReadonlyArray<{
  scope: readonly unknown[];
  config: Partial<QueryKeyScopeConfig>;
}> = [
  { scope: ["sessions"], config: { staleMs: 15_000, maxEntries: 60 } },
  { scope: ["sessions", "active"], config: { staleMs: 10_000 } },
  { scope: ["sessions", "*", "thread"], config: { staleMs: 5_000, maxEntries: 30 } },
  { scope: ["chat-attempt"], config: { staleMs: 15_000, maxEntries: 40 } },
  { scope: ["kanban"], config: { staleMs: 60_000, maxAgeMs: 10 * 60_000, maxEntries: 80 } },
  { scope: ["runtime"], config: { staleMs: 30_000, maxAgeMs: 8 * 60_000, maxEntries: 40 } },
];

type Listener = () => void;

export interface QueryClientOptions {
  /** Injectable clock for deterministic tests. Defaults to Date.now. */
  now?: () => number;
  defaultConfig?: Partial<QueryKeyScopeConfig>;
  configs?: ReadonlyArray<{ scope: readonly unknown[]; config: Partial<QueryKeyScopeConfig> }>;
}

/**
 * Deterministic, dependency-free server-state cache engine. `subscribe` /
 * `getSnapshot` expose a stable read cursor for useSyncExternalStore; reads are
 * keyed by `serializeQueryKey` and are LRU-bounded and stale-aware.
 */
export class QueryClient {
  private cache = new Map<string, QueryCacheEntry>();
  private listeners = new Set<Listener>();
  private inFlight = new Map<string, Promise<unknown>>();
  /** Last automatic/`fetchQuery` attempt per key, for refetch backoff. */
  private lastFetchAt = new Map<string, number>();
  private configList: { scope: readonly unknown[]; config: QueryKeyScopeConfig }[] = [];
  private defaultConfig: QueryKeyScopeConfig;
  private now: () => number;

  constructor(opts: QueryClientOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.defaultConfig = { ...QUERY_DEFAULTS, ...opts.defaultConfig };
    for (const c of BUILTIN_QUERY_CONFIGS) this.configure(c.scope, c.config);
    for (const c of opts.configs ?? []) this.configure(c.scope, c.config);
  }

  // --- subscription / read cursor -------------------------------------------

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Stable snapshot of the full cache (identity only changes after a write). */
  getSnapshot(): Map<string, QueryCacheEntry> {
    return this.cache;
  }

  // --- config ----------------------------------------------------------------

  /** Register/merge a per-scope config; longest matching scope wins on resolve. */
  configure(scope: readonly unknown[], patch: Partial<QueryKeyScopeConfig>): void {
    const existing = this.configList.find(
      (c) => c.scope.length === scope.length && c.scope.every((s, i) => s === scope[i]),
    );
    const merged: QueryKeyScopeConfig = {
      ...(existing?.config ?? { ...QUERY_DEFAULTS, ...this.pick(scope) }),
      ...patch,
    };
    if (existing) existing.config = merged;
    else this.configList.push({ scope, config: merged });
  }

  /** Resolve config for a key by longest wildcard-aware scope prefix match. */
  resolveConfig(qk: QueryKey): QueryKeyScopeConfig {
    const rel = qk.slice(3); // strip [root, "workspace", ws]
    let best: { len: number; cfg: QueryKeyScopeConfig } | null = null;
    for (const { scope, config } of this.configList) {
      if (scope.length > rel.length) continue;
      let ok = true;
      for (let i = 0; i < scope.length; i += 1) {
        if (scope[i] !== "*" && scope[i] !== rel[i]) { ok = false; break; }
      }
      if (ok && (!best || scope.length > best.len)) best = { len: scope.length, cfg: config };
    }
    return best?.cfg ?? this.defaultConfig;
  }

  private pick(scope: readonly unknown[]): QueryKeyScopeConfig {
    let out: QueryKeyScopeConfig | null = null;
    let bestLen = -1;
    for (const { scope: s, config } of this.configList) {
      if (s.length > scope.length || s.length <= bestLen) continue;
      let ok = true;
      for (let i = 0; i < s.length; i += 1) {
        if (s[i] !== "*" && s[i] !== scope[i]) { ok = false; break; }
      }
      if (ok) { out = config; bestLen = s.length; }
    }
    return out ?? this.defaultConfig;
  }

  // --- reads -----------------------------------------------------------------

  get<T = unknown>(qk: QueryKey): QueryCacheEntry<T> | undefined {
    const hash = serializeQueryKey(qk);
    const e = this.cache.get(hash);
    if (e) this.touch(hash); // move to MRU end for LRU eviction
    return e as QueryCacheEntry<T> | undefined;
  }

  getData<T = unknown>(qk: QueryKey): T | undefined {
    return this.get<T>(qk)?.data;
  }

  /** True when data is fresh enough to serve without any fetch. */
  isFresh(qk: QueryKey): boolean {
    const e = this.cache.get(serializeQueryKey(qk));
    if (!e || e.status !== "success") return false;
    return this.now() - e.updatedAt < this.resolveConfig(qk).staleMs;
  }

  isFetching(qk: QueryKey): boolean {
    return this.inFlight.has(serializeQueryKey(qk));
  }

  // --- writes ----------------------------------------------------------------

  setData<T>(qk: QueryKey, data: T, at: number = this.now()): void {
    const hash = serializeQueryKey(qk);
    const prior = this.cache.get(hash);
    this.cache.set(hash, {
      key: qk,
      data,
      status: "success",
      error: undefined,
      updatedAt: at,
      fetching: false,
    });
    this.enforceLimits(qk);
    if (prior?.status !== "success" || prior.data !== data) this.emit();
  }

  setError(qk: QueryKey, error: unknown, at: number = this.now()): void {
    const hash = serializeQueryKey(qk);
    const prior = this.cache.get(hash);
    this.cache.set(hash, {
      key: qk,
      data: prior?.data,
      status: "error",
      error,
      updatedAt: prior?.updatedAt ?? at,
      fetching: false,
    });
    this.emit();
  }

  private setFetching(qk: QueryKey, fetching: boolean): void {
    const hash = serializeQueryKey(qk);
    const prior = this.cache.get(hash);
    this.cache.set(hash, {
      key: qk,
      data: prior?.data,
      status: prior?.status ?? "pending",
      error: prior?.error,
      updatedAt: prior?.updatedAt ?? 0,
      fetching,
    });
    this.emit();
  }

  /** Clear every key whose serialized hash starts with the given prefix. */
  invalidate(prefix: QueryKey): void {
    const hashPrefix = serializeQueryKey(prefix);
    let changed = false;
    for (const hash of [...this.cache.keys()]) {
      if (hash.startsWith(hashPrefix)) {
        this.cache.delete(hash);
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  clear(): void {
    if (this.cache.size === 0) return;
    this.cache.clear();
    this.emit();
  }

  // --- fetching / coalescing / staleness -------------------------------------

  /**
   * Fetch once per key: concurrent calls share a single in-flight promise, so
   * N awaited same-key reads produce exactly one network call.
   */
  async fetchQuery<T>(qk: QueryKey, fetcher: () => Promise<T>): Promise<T> {
    const hash = serializeQueryKey(qk);
    const existing = this.inFlight.get(hash);
    if (existing) return existing as Promise<T>;

    const promise = (async () => {
      this.lastFetchAt.set(hash, this.now());
      this.setFetching(qk, true);
      try {
        const data = await fetcher();
        this.setData(qk, data, this.now());
        return data;
      } catch (err) {
        this.setError(qk, err, this.now());
        throw err;
      } finally {
        this.inFlight.delete(hash);
        this.setFetching(qk, false);
      }
    })();
    this.inFlight.set(hash, promise);
    return promise;
  }

  /**
   * Stale-aware entry point: fresh -> serve cache; stale within maxAge -> serve
   * stale and refetch in the background (throttled by backoff); older than
   * maxAge (or a miss) -> hard fetch. Coalesces concurrent same-key reads.
   */
  async ensureQuery<T>(qk: QueryKey, fetcher: () => Promise<T>): Promise<T> {
    const hash = serializeQueryKey(qk);
    const inFlight = this.inFlight.get(hash);
    if (inFlight) return inFlight as Promise<T>;

    const cfg = this.resolveConfig(qk);
    const now = this.now();
    const e = this.cache.get(hash);

    if (e?.status === "success") {
      const age = now - e.updatedAt;
      if (age < cfg.staleMs) {
        this.touch(hash);
        return e.data as T; // fresh: no fetch
      }
      if (age < cfg.maxAgeMs) {
        const last = this.lastFetchAt.get(hash) ?? 0;
        if (now - last >= cfg.retryBackoffMs) {
          // Background refetch — never blocks the stale read.
          this.fetchQuery(qk, fetcher).catch(() => {});
        }
        this.touch(hash);
        return e.data as T; // stale-while-revalidate
      }
      // Beyond maxAge: evict and treat as a clean miss.
      this.evictHash(hash);
    }
    return this.fetchQuery(qk, fetcher);
  }

  // --- LRU / bounds ----------------------------------------------------------

  private touch(hash: string): void {
    const e = this.cache.get(hash);
    if (!e) return;
    this.cache.delete(hash);
    this.cache.set(hash, e); // reinsert at MRU end
  }

  private evictHash(hash: string): void {
    if (!this.cache.delete(hash)) return;
    this.emit();
  }

  private evictScope(qk: QueryKey, cfg: QueryKeyScopeConfig, justHash: string): void {
    if (cfg.maxEntries <= 0) return;
    // Keys resolving to the same config share one LRU capacity.
    const inScope: string[] = [];
    for (const [h] of this.cache) {
      if (h === justHash || this.resolveConfig(this.cache.get(h)!.key) === cfg) inScope.push(h);
    }
    const excess = inScope.length - cfg.maxEntries;
    if (excess <= 0) return;
    // inScope is in Map insertion order (most-recent last).
    for (let i = 0; i < excess && inScope.length; i += 1) {
      const oldest = inScope.shift()!;
      this.cache.delete(oldest);
    }
    this.emit();
  }

  private enforceLimits(qk: QueryKey): void {
    const hash = serializeQueryKey(qk);
    const cfg = this.resolveConfig(qk);
    this.evictScope(qk, cfg, hash);
    if (this.cache.size > GLOBAL_MAX_ENTRIES) {
      const excess = this.cache.size - GLOBAL_MAX_ENTRIES;
      for (let i = 0; i < excess; i += 1) {
        const oldest = this.cache.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        this.cache.delete(oldest);
      }
      this.emit();
    }
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}