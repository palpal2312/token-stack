import assert from "node:assert/strict";
import test from "node:test";
import { queryKeys } from "../../src/lib/query/query-keys";
import { QueryClient } from "../../src/lib/query/query-cache";

/**
 * Phase 19a U3 — unified query cache (custom, library-free). Pure engine tests
 * against the typed key factories with an injectable clock and a fake fetch,
 * mirroring the established node:test + tsx runner.
 */

/** Deterministic clock + a fake fetch that counts network calls. */
function makeEnv(initial = 0) {
  let t = initial;
  let calls = 0;
  return {
    now: () => t,
    advance: (ms: number) => { t += ms; },
    calls: () => calls,
    /** A fetcher that does ONE fake "network" call and returns `result`. */
    fetchCounted: <T>(result: T) => async () => {
      calls += 1;
      return structuredClone(result);
    },
    };
}

/** A manually-resolvable promise, for gating a fetch so we can observe in-flight coalescing. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test("key isolation: distinct keys never share cached data or status", async () => {
  const { now, fetchCounted } = makeEnv();
  const client = new QueryClient({ now });
  const a = queryKeys.runtime.snapshot("wsA");
  const b = queryKeys.runtime.attempts("wsA");

  await client.fetchQuery(a, fetchCounted({ n: 1 }));
  await client.fetchQuery(b, fetchCounted({ n: 2 }));

  assert.deepEqual(client.getData(a), { n: 1 });
  assert.deepEqual(client.getData(b), { n: 2 });
  assert.notEqual(client.get(a), client.get(b), "entries must be distinct objects");
  assert.equal(client.get(a)?.status, "success");
  assert.equal(client.get(b)?.status, "success");
});

test("TTL eviction: data older than maxAge is a hard miss that refetches, never stale-served", async () => {
  const { now, advance, calls, fetchCounted } = makeEnv();
  const client = new QueryClient({
    now,
    configs: [{ scope: ["runtime"], config: { staleMs: 5, maxAgeMs: 10, retryBackoffMs: 1000 } }],
  });
  const k = queryKeys.runtime.snapshot("wsA");

  const d1 = await client.ensureQuery(k, fetchCounted("fresh"));
  assert.equal(d1, "fresh");
  assert.equal(calls(), 1);
  assert.ok(client.isFresh(k), "just written data is fresh");

  advance(20); // beyond maxAgeMs
  const d2 = await client.ensureQuery(k, fetchCounted("evicted"));
  assert.equal(d2, "evicted", "past maxAge must refetch, not serve stale");
  assert.equal(calls(), 2);
  assert.equal(client.getData(k), "evicted");
});

test("max-entry eviction: exceeding a scope cap evicts the least-recently-used key", async () => {
  const { now, fetchCounted } = makeEnv();
  const client = new QueryClient({
    now,
    configs: [{ scope: ["runtime"], config: { maxEntries: 2 } }],
  });
  // Three keys all resolving to the ["runtime"] scope share one 2-entry budget.
  const k1 = queryKeys.runtime.snapshot("wsA"); // inserted first -> LRU
  const k2 = queryKeys.runtime.attempts("wsA");
  const k3 = queryKeys.runtime.snapshot("wsB");

  await client.fetchQuery(k1, fetchCounted("one"));
  await client.fetchQuery(k2, fetchCounted("two"));
  await client.fetchQuery(k3, fetchCounted("three")); // forces eviction of the LRU (k1)

  assert.equal(client.getData(k1), undefined, "least-recently-used entry must be evicted");
  assert.equal(client.getData(k2), "two");
  assert.equal(client.getData(k3), "three");

  // Touching k2 makes it most-recently-used; a fourth insert evicts k3 (the new LRU).
  void client.get(k2);
  await client.fetchQuery(queryKeys.runtime.attempts("wsC"), fetchCounted("four"));
  assert.equal(client.getData(k3), undefined, "LRU order must follow access, not insertion");
  assert.equal(client.getData(k2), "two");
});

test("in-flight coalescing: N awaited same-key reads -> 1 network call", async () => {
  const { now, calls } = makeEnv();
  const client = new QueryClient({ now });
  const k = queryKeys.thread.detail("wsA", "s1");

  let networkCalls = 0;
  const gate = deferred<string>();
  const fetcher = async () => {
    networkCalls += 1;
    return gate.promise;
  };

  const reads = Promise.all([
    client.ensureQuery(k, fetcher),
    client.ensureQuery(k, fetcher),
    client.ensureQuery(k, fetcher),
  ]);
  await Promise.resolve(); // let the first read grab the in-flight slot
  assert.equal(networkCalls, 1, "concurrent same-key reads must share one in-flight promise");
  gate.resolve("done");
  assert.deepEqual(await reads, ["done", "done", "done"]);
  assert.equal(networkCalls, 1, "all awaited readers must resolve from the single call");
  void calls;
});

test("stale refetch with backoff: stale served + background refetch, throttled", async () => {
  const { now, advance, calls, fetchCounted } = makeEnv();
  const client = new QueryClient({
    now,
    configs: [{
      scope: ["runtime"],
      config: { staleMs: 10, maxAgeMs: 1000, retryBackoffMs: 50 },
    }],
  });
  const k = queryKeys.runtime.snapshot("wsA");

  await client.ensureQuery(k, fetchCounted("v0"));
  assert.equal(calls(), 1);

  advance(100); // stale (>staleMs) but within maxAge
  const stale = await client.ensureQuery(k, fetchCounted("v1"));
  assert.equal(stale, "v0", "stale read must serve the cached value, not block");
  await flushAsync();
  assert.equal(calls(), 2, "stale read must trigger exactly one background refetch");

  advance(10); // within backoff window
  await client.ensureQuery(k, fetchCounted("v2"));
  await flushAsync();
  assert.equal(calls(), 2, "backoff must throttle repeated stale refetches");

  advance(60); // past backoff
  await client.ensureQuery(k, fetchCounted("v3"));
  await flushAsync();
  assert.equal(calls(), 3, "past backoff the next stale read may refetch");
});

test("no cross-workspace bleed: identical entity id in two workspaces stays independent", async () => {
  const { now, calls, fetchCounted } = makeEnv();
  const client = new QueryClient({ now });
  const a = queryKeys.sessions.detail("wsA", "s1");
  const b = queryKeys.sessions.detail("wsB", "s1");

  const dataA = await client.ensureQuery(a, fetchCounted("A-data"));
  assert.equal(dataA, "A-data");
  assert.equal(calls(), 1);
  const dataB = await client.ensureQuery(b, fetchCounted("B-data"));
  assert.equal(dataB, "B-data", "a fresh wsA key must NOT satisfy a wsB read");
  assert.equal(calls(), 2, "each workspace must own its own network state");
  assert.equal(client.getData(a), "A-data");
  assert.equal(client.getData(b), "B-data");

  client.invalidate(queryKeys.sessions.all("wsA"));
  assert.equal(client.getData(a), undefined, "invalidate is workspace-scoped");
  assert.equal(client.getData(b), "B-data", "wsB unaffected by wsA invalidation");
});

test("fresh reads are served from cache with zero additional network calls", async () => {
  const { now, calls, fetchCounted } = makeEnv();
  const client = new QueryClient({ now, configs: [{ scope: ["runtime"], config: { staleMs: 60_000 } }] });
  const k = queryKeys.runtime.snapshot("wsA");

  await client.ensureQuery(k, fetchCounted({ v: 1 }));
  assert.equal(calls(), 1);
  const again = await client.ensureQuery(k, fetchCounted({ v: 2 }));
  assert.equal(calls(), 1, "fresh data must be served from cache");
  assert.deepEqual(again, { v: 1 });
});

/** Drain one macrotask so background (throttled) refetches have a chance to start. */
function flushAsync(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}