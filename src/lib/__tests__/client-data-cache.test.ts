import assert from "node:assert/strict";
import test from "node:test";
import {
  CachePresets,
  cacheKey,
  cachedFetchJson,
  clearClientDataCache,
  fetchAndCacheJson,
  invalidateCache,
  peekCache,
  readCache,
  setCache,
} from "../client-data-cache";

test("fresh hit skips fetcher", async () => {
  clearClientDataCache();
  let calls = 0;
  setCache("k", { n: 1 });
  const first = await cachedFetchJson("k", async () => {
    calls += 1;
    return { n: 2 };
  }, CachePresets.static);
  assert.equal(first.fromCache, true);
  assert.deepEqual(first.data, { n: 1 });
  assert.equal(calls, 0);
});

test("miss awaits network and stores", async () => {
  clearClientDataCache();
  let calls = 0;
  const res = await cachedFetchJson("miss", async () => {
    calls += 1;
    return { ok: true };
  }, { ttlMs: 60_000, staleMs: 120_000 });
  assert.equal(res.fromCache, false);
  assert.deepEqual(res.data, { ok: true });
  assert.equal(calls, 1);
  assert.deepEqual(peekCache("miss"), { ok: true });
});

test("stale hit awaits refresh", async () => {
  clearClientDataCache();
  setCache("stale", { v: 1 }, Date.now() - 40_000);
  let calls = 0;
  const res = await cachedFetchJson("stale", async () => {
    calls += 1;
    return { v: 2 };
  }, { ttlMs: 10_000, staleMs: 120_000 });
  assert.equal(res.fromCache, false);
  assert.equal(calls, 1);
  assert.deepEqual(res.data, { v: 2 });
  assert.deepEqual(peekCache("stale"), { v: 2 });
});

test("force bypasses fresh cache", async () => {
  clearClientDataCache();
  setCache("force", { v: 1 });
  const res = await cachedFetchJson("force", async () => ({ v: 9 }), {
    ...CachePresets.static,
    force: true,
  });
  assert.equal(res.fromCache, false);
  assert.deepEqual(res.data, { v: 9 });
});

test("expired past staleMs still refreshes via cachedFetchJson", async () => {
  clearClientDataCache();
  setCache("old", { v: 1 }, Date.now() - 20 * 60_000);
  const hit = readCache("old", { ttlMs: 10_000, staleMs: 60_000 });
  assert.equal(hit?.usable, false);
  const res = await cachedFetchJson("old", async () => ({ v: 3 }), {
    ttlMs: 10_000,
    staleMs: 60_000,
  });
  assert.equal(res.fromCache, false);
  assert.deepEqual(res.data, { v: 3 });
});

test("inflight dedupes concurrent misses", async () => {
  clearClientDataCache();
  let calls = 0;
  let resolve!: (v: { n: number }) => void;
  const gate = new Promise<{ n: number }>((r) => { resolve = r; });
  const fetcher = async () => {
    calls += 1;
    return gate;
  };
  const a = fetchAndCacheJson("dup", fetcher);
  const b = fetchAndCacheJson("dup", fetcher);
  resolve({ n: 5 });
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(calls, 1);
  assert.deepEqual(ra, { n: 5 });
  assert.deepEqual(rb, { n: 5 });
});

test("invalidateCache drops key and prefix*", () => {
  clearClientDataCache();
  setCache(cacheKey("GET", "/api/builders"), { a: 1 });
  setCache(cacheKey("GET", "/api/builders?x=1"), { a: 2 });
  setCache(cacheKey("GET", "/api/routers"), { b: 1 });
  invalidateCache(cacheKey("GET", "/api/builders"));
  assert.equal(peekCache(cacheKey("GET", "/api/builders")), undefined);
  assert.ok(peekCache(cacheKey("GET", "/api/builders?x=1")));
  invalidateCache(`${cacheKey("GET", "/api/builders")}*`);
  assert.equal(peekCache(cacheKey("GET", "/api/builders?x=1")), undefined);
  assert.ok(peekCache(cacheKey("GET", "/api/routers")));
});

test("readCache reports freshness", () => {
  clearClientDataCache();
  setCache("age", { ok: true }, Date.now() - 5_000);
  const hit = readCache("age", { ttlMs: 10_000, staleMs: 60_000 });
  assert.ok(hit);
  assert.equal(hit.fresh, true);
  assert.equal(hit.usable, true);
});
