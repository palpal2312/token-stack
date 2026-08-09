/**
 * In-memory client data cache for soft navigation.
 *
 * Soft route changes remount page components but keep the JS module graph,
 * so this Map survives. First visit of a key is cold (network). Warm revisits
 * within `ttlMs` skip the network. Past `ttlMs`, callers can still paint from
 * `readCache` / `peekCache` instantly, then await a refresh.
 *
 * Network requests still use `cache: "no-store"` — this layer is intentional
 * app cache, not the browser HTTP cache.
 */

export type CachePolicy = {
  /** Fresh window: serve cache, no network. Default 30s. */
  ttlMs?: number;
  /** How long a stale entry may still be painted before a cold wait. Default 5min. */
  staleMs?: number;
  /** Bypass cache; always hit the network and replace the entry. */
  force?: boolean;
};

type Entry<T> = {
  data: T;
  fetchedAt: number;
  inflight: Promise<T> | null;
};

const store = new Map<string, Entry<unknown>>();

/** Sensible defaults for dashboard list payloads. */
export const CachePresets = {
  /** CLI configs, routers, integrations catalogs. */
  static: { ttlMs: 60_000, staleMs: 15 * 60_000 } satisfies CachePolicy,
  /** Goals, agents, automations — change often but fine for snappy nav. */
  semi: { ttlMs: 20_000, staleMs: 5 * 60_000 } satisfies CachePolicy,
  /** Live snapshots (Herdr, kanban cards) — brief warm remount only. */
  live: { ttlMs: 8_000, staleMs: 90_000 } satisfies CachePolicy,
} as const;

export function cacheKey(method: string, url: string): string {
  return `${method.toUpperCase()} ${url}`;
}

/** Shared keys so multiple pages reuse the same warm payload. */
export const ClientCacheKeys = {
  builders: cacheKey("GET", "/api/builders"),
  buildersSummary: cacheKey("GET", "/api/builders?summary=1"),
  routers: cacheKey("GET", "/api/routers"),
  integrations: cacheKey("GET", "/api/integrations"),
  agents: cacheKey("GET", "/api/agents"),
  goals: cacheKey("GET", "/api/goals"),
  automations: cacheKey("GET", "/api/automations"),
  approvals: cacheKey("GET", "/api/approvals"),
  herdrSnapshot: cacheKey("GET", "/api/herdr/snapshot"),
  arenaRuns: cacheKey("GET", "/api/arena/runs?limit=50"),
  loopBuilds: cacheKey("GET", "/api/loop/builds"),
  kanbanCards: cacheKey("GET", "/api/agent-kanban/cards"),
  kanbanConfig: cacheKey("GET", "/api/agent-kanban/config"),
  kanbanWorkspace: cacheKey("GET", "/api/agent-kanban/workspace"),
} as const;

export function peekCache<T>(key: string): T | undefined {
  const entry = store.get(key) as Entry<T> | undefined;
  return entry?.data;
}

export function readCache<T>(
  key: string,
  policy: CachePolicy = {},
): { data: T; ageMs: number; fresh: boolean; usable: boolean } | null {
  const entry = store.get(key) as Entry<T> | undefined;
  if (!entry || entry.fetchedAt <= 0) return null;
  const ttlMs = policy.ttlMs ?? 30_000;
  const staleMs = policy.staleMs ?? 5 * 60_000;
  const ageMs = Date.now() - entry.fetchedAt;
  return {
    data: entry.data,
    ageMs,
    fresh: ageMs < ttlMs,
    usable: ageMs < staleMs,
  };
}

export function setCache<T>(key: string, data: T, fetchedAt = Date.now()): void {
  const prev = store.get(key) as Entry<T> | undefined;
  store.set(key, { data, fetchedAt, inflight: prev?.inflight ?? null });
}

/** Drop one key, or every key that starts with `prefix` when prefix ends with `*`. */
export function invalidateCache(keyOrPrefix: string): void {
  if (keyOrPrefix.endsWith("*")) {
    const prefix = keyOrPrefix.slice(0, -1);
    for (const k of store.keys()) {
      if (k.startsWith(prefix)) store.delete(k);
    }
    return;
  }
  store.delete(keyOrPrefix);
}

/** Test helper. */
export function clearClientDataCache(): void {
  store.clear();
}

/** Always hit the network (deduped), then store. */
export async function fetchAndCacheJson<T>(
  key: string,
  fetcher: () => Promise<T>,
): Promise<T> {
  const existing = store.get(key) as Entry<T> | undefined;
  if (existing?.inflight) return existing.inflight;

  const inflight = (async () => {
    try {
      const data = await fetcher();
      store.set(key, { data, fetchedAt: Date.now(), inflight: null });
      return data;
    } catch (err) {
      const cur = store.get(key) as Entry<T> | undefined;
      if (cur) cur.inflight = null;
      else store.delete(key);
      throw err;
    }
  })();

  if (existing) existing.inflight = inflight;
  else store.set(key, { data: undefined as T, fetchedAt: 0, inflight });

  return inflight;
}

/**
 * Fetch JSON through the client cache.
 * - Fresh hit (and not force): returns cached data, no network.
 * - Otherwise: awaits network, stores, returns.
 *
 * For snappy remounts: `readCache` first to paint, then call this (stale/miss
 * will refresh). Fresh hits skip the network entirely.
 */
export async function cachedFetchJson<T>(
  key: string,
  fetcher: () => Promise<T>,
  policy: CachePolicy = {},
): Promise<{ data: T; fromCache: boolean }> {
  if (!policy.force) {
    const hit = readCache<T>(key, policy);
    if (hit?.fresh) {
      return { data: hit.data, fromCache: true };
    }
  }

  const data = await fetchAndCacheJson(key, fetcher);
  return { data, fromCache: false };
}

/**
 * Convenience: GET `url` as JSON with `cache: "no-store"`, keyed by the URL.
 */
export async function cachedGetJson<T = Record<string, unknown>>(
  url: string,
  policy: CachePolicy & { signal?: AbortSignal } = {},
): Promise<{ data: T; fromCache: boolean }> {
  const key = cacheKey("GET", url);
  const { signal, ...rest } = policy;
  return cachedFetchJson<T>(
    key,
    async () => {
      const res = await fetch(url, { cache: "no-store", signal });
      try {
        return (await res.json()) as T;
      } catch {
        return { error: `The server returned ${res.status} with no explanation.` } as T;
      }
    },
    rest,
  );
}
