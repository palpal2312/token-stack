"use client";

/**
 * Single query-cache authority for the desktop shell (Phase 19a U1..U3, query
 * contract). Exactly ONE provider is mounted under the shell when the flag is
 * on; there is no second server-state authority and no duplicate global
 * realtime/listener wiring. Conversation/session state authority stays with
 * Phase 8b canonical IDs — this cache only locates cached reads of it.
 *
 * The engine (`query-cache.ts`) is a library-free server-state cache: bounded
 * windows, LRU eviction, scoped defaults, request coalescing, and refetch-on-
 * stale with backoff. A tiny external store built on React's useSyncExternalStore
 * binds it here so components subscribe to the primitive flag/data they need.
 *
 * TanStack Query: phase 19a RECOMMENDS `@tanstack/react-query` as the eventual
 * layer, deferred to a Phase 20 dependency/license/security review. The custom
 * engine satisfies the U3 contract now; a TanStack migration would wrap the same
 * typed key factories.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { serializeQueryKey, type QueryKey } from "./query-keys";
import { QueryClient, type QueryCacheEntry } from "./query-cache";

export { QueryClient } from "./query-cache";
export type {
  QueryStatus,
  QueryCacheEntry,
  QueryKeyScopeConfig,
  QueryClientOptions,
} from "./query-cache";
export { QUERY_DEFAULTS, GLOBAL_MAX_ENTRIES, BUILTIN_QUERY_CONFIGS } from "./query-cache";

interface QueryClientValue {
  client: QueryClient;
  useQuery: <T>(qk: QueryKey) => QueryCacheEntry<T> | undefined;
}

const QueryClientContext = createContext<QueryClientValue | null>(null);

/** Mounted exactly once, under the shell, when the flag is on — one store per workspace. */
export function QueryProvider({ children }: { children: ReactNode }) {
  const clientRef = useRef<QueryClient | null>(null);
  if (clientRef.current === null) clientRef.current = new QueryClient();
  const client = clientRef.current;

  const useQuery = useCallback(
    function useQuery<T>(qk: QueryKey): QueryCacheEntry<T> | undefined {
      return useSyncExternalStore<QueryCacheEntry<T> | undefined>(
        (cb) => client.subscribe(cb),
        () => client.getSnapshot().get(serializeQueryKey(qk)) as QueryCacheEntry<T> | undefined,
      );
    },
    [client],
  );

  const value = useMemo<QueryClientValue>(
    () => ({ client, useQuery }),
    [client, useQuery],
  );

  return <QueryClientContext.Provider value={value}>{children}</QueryClientContext.Provider>;
}

/** Access the single query cache + typed get/set/invalidate/ensure helpers. */
export function useQueryClient(): QueryClientValue {
  const v = useContext(QueryClientContext);
  if (!v) throw new Error("useQueryClient must be used within QueryProvider");
  return v;
}