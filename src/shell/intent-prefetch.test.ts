import { test } from "node:test";
import assert from "node:assert/strict";

import { createPrefetchController } from "./intent-prefetch";

test("same-key dedupe loads work once", async () => {
  const c = createPrefetchController();
  let loads = 0;
  let resolve!: () => void;
  const work = () => new Promise<void>((r) => { loads++; resolve = r; });
  c.start("k1", work);
  assert.equal(loads, 1);
  assert.equal(c.state("k1"), "in-flight");
  c.start("k1", work); // same key in-flight: deduped
  assert.equal(loads, 1);
  resolve();
  await Promise.resolve();
  assert.equal(c.state("k1"), "done");
});

test("intent change cancels previous prefetch (late resolve dropped)", async () => {
  const c = createPrefetchController();
  let resolveA!: () => void;
  let resolveB!: () => void;
  c.start("a", () => new Promise<void>((r) => { resolveA = r; }));
  c.start("b", () => new Promise<void>((r) => { resolveB = r; }));
  resolveA(); // late resolve for the cancelled key
  await Promise.resolve();
  assert.equal(c.state("a"), "cancelled");
  assert.equal(c.state("b"), "in-flight");
  resolveB();
  await Promise.resolve();
  assert.equal(c.state("b"), "done");
});

test("commit cancels in-flight and marks done", () => {
  const c = createPrefetchController();
  c.start("k1", () => Promise.resolve());
  c.commit("k1");
  assert.equal(c.state("k1"), "done");
  assert.ok(!Object.values(c.snapshot()).includes("in-flight"));
});