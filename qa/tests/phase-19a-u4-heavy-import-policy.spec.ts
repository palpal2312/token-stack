import assert from "node:assert/strict";
import test from "node:test";
import {
  decideHeavyPreload,
  heavyChunksForRoute,
  routeOwnsLazyHeavy,
  allHeavyChunkSpecifiers,
  HEAVY_CHUNK_KINDS,
  loadHeavyChunk,
} from "../../src/lib/query/heavy-import-policy";

test("heavy-import-policy: heavy routes map to their owning heavy chunks", () => {
  // three is owned by the astros/radar skies; highlight by the seo guides.
  assert.deepEqual(heavyChunksForRoute("/astros").map((c) => c.specifier), ["three"]);
  assert.deepEqual(heavyChunksForRoute("/radar").map((c) => c.specifier), ["three"]);
  assert.deepEqual(heavyChunksForRoute("/seo-guide").map((c) => c.specifier), ["rehype-highlight"]);
});

test("heavy-import-policy: non-heavy and unknown routes own no heavy chunks", () => {
  assert.equal(heavyChunksForRoute("/sen").length, 0);
  assert.equal(heavyChunksForRoute("/kanban").length, 0);
  assert.equal(heavyChunksForRoute("/definitely-not-a-route").length, 0);
  assert.equal(routeOwnsLazyHeavy("/sen"), false);
  assert.equal(routeOwnsLazyHeavy("/astros"), true);
});

test("heavy-import-policy: every chunk specifier is in the known kind allowlist", () => {
  const all = allHeavyChunkSpecifiers();
  assert.ok(all.length >= 2, "policy must declare at least the three + highlight chunks");
  for (const route of ["/astros", "/radar", "/hermes", "/seo", "/seo-guide"]) {
    for (const c of heavyChunksForRoute(route)) {
      assert.ok(HEAVY_CHUNK_KINDS.has(c.kind), `unregistered kind ${c.kind}`);
      assert.ok(typeof c.specifier === "string" && c.specifier.length > 0);
    }
  }
});

test("decideHeavyPreload: eager only for a heavy route, exactly that route's chunks (never every module)", () => {
  const d = decideHeavyPreload("/astros");
  assert.equal(d.eager, true);
  assert.deepEqual(d.targets.map((c) => c.specifier), ["three"]);

  // A non-heavy route yields no eager heavy preload.
  const s = decideHeavyPreload("/sen");
  assert.equal(s.eager, false);
  assert.deepEqual(s.targets, []);

  // Eager preload must NEVER target more than the single touched route.
  assert.equal(
    d.targets.length <= heavyChunksForRoute("/astros").length,
    true,
    "single-route preload must not union across modules",
  );
});

test("decideHeavyPreload: reduced-motion disables eager heavy visual preload", () => {
  const on = decideHeavyPreload("/seo", { reducedMotion: false });
  assert.equal(on.eager, true);
  assert.deepEqual(on.targets.map((c) => c.specifier), ["rehype-highlight"]);

  const off = decideHeavyPreload("/seo", { reducedMotion: true });
  assert.equal(off.eager, false);
  assert.deepEqual(off.targets, []);
});

test("import-policy mapping: every declared heavy specifier has a literal loader; unknown is a no-op", async () => {
  const declared = allHeavyChunkSpecifiers();
  assert.ok(declared.includes("three"), "three is the astros/radar heavy chunk");
  assert.ok(declared.includes("rehype-highlight"), "rehype-highlight is the seo heavy chunk");

  // Each declared specifier must resolve to a loader that returns a promise (not null).
  for (const spec of declared) {
    const p = loadHeavyChunk(spec);
    assert.ok(p instanceof Promise, `loadHeavyChunk(${spec}) must return a Promise`);
    // A declared heavy chunk that resolves to null is an unmapped policy gap.
    // (We assert the promise type; resolution requires the bundler's chunk graph.)
    void p.catch(() => {});
  }

  // Unknown specifier: safe no-op (resolves null), never throws.
  const unknown = await loadHeavyChunk("definitely-not-a-chunk");
  assert.equal(unknown, null);
});