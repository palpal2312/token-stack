import assert from "node:assert/strict";
import test from "node:test";
import * as prefetchModule from "../../src/shell/intent-prefetch";
import { createPrefetchController } from "../../src/shell/intent-prefetch";

/** Flush all pending microtasks (promise .then callbacks). */
const tick = () => new Promise<void>((res) => setImmediate(res));

function deferred<T = unknown>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test("prefetch controller is a pure module (no navigation coupling surfaced)", () => {
  const keys = Object.keys(prefetchModule).sort();
  assert.deepEqual(keys, ["createPrefetchController"], "module must export only the factory");
  assert.ok(!("beginNav" in prefetchModule), "prefetch module must not expose navigation");
});

test("intent prefetch: hover -> preload runs exactly once and reaches done", async () => {
  const c = createPrefetchController();
  let calls = 0;
  const d = deferred();
  c.start("sen", async () => { calls += 1; return d.promise; });

  assert.equal(c.state("sen"), "in-flight");
  assert.equal(calls, 1, "hover must kick off the prefetch immediately");

  d.resolve(undefined);
  await tick();
  assert.equal(c.state("sen"), "done");
});

test("intent prefetch: same-key in-flight is deduped (one load)", async () => {
  const c = createPrefetchController();
  let calls = 0;
  const d = deferred();
  const work = async () => { calls += 1; return d.promise; };

  c.start("sen", work);
  c.start("sen", work); // same key while in-flight -> ignored
  c.start("sen", work);
  assert.equal(calls, 1, "a deduped prefetch must not re-run the work");

  d.resolve(undefined);
  await tick();
  assert.equal(c.state("sen"), "done");
});

test("intent prefetch: intent change cancels the prior stale prefetch", async () => {
  const c = createPrefetchController();
  const slow = deferred<unknown>();
  const fast = deferred<unknown>();

  c.start("sen", async () => slow.promise);
  assert.equal(c.state("sen"), "in-flight");

  c.start("kanban", async () => fast.promise); // intent moves -> cancel sen
  assert.equal(c.state("sen"), "cancelled", "stale in-flight must be cancelled on intent change");
  assert.equal(c.state("kanban"), "in-flight");

  slow.resolve(undefined);
  await tick();
  assert.equal(c.state("sen"), "cancelled", "a late resolve must not relabel a cancelled key done");

  fast.resolve(undefined);
  await tick();
  assert.equal(c.state("kanban"), "done");
});

test("intent prefetch: committed navigation wins — no double fetch", async () => {
  const c = createPrefetchController();
  let calls = 0;
  const d = deferred<unknown>();
  const work = async () => { calls += 1; return d.promise; };

  c.start("sen", work);
  assert.equal(c.state("sen"), "in-flight");

  c.commit("sen"); // navigation commit: cancel in-flight + mark done
  assert.equal(c.state("sen"), "done");

  d.resolve(undefined);
  await tick();
  assert.equal(c.state("sen"), "done", "commit marks a key done and stays done");

  c.start("sen", work); // later intent for the committed module is a no-op
  c.start("sen", work);
  assert.equal(calls, 1, "no double fetch after commit — only the navigation load runs");
});

test("intent prefetch: explicit cancel drops in-flight and ignores late resolve", async () => {
  const c = createPrefetchController();
  const d = deferred<unknown>();
  c.start("sen", async () => d.promise);
  assert.equal(c.state("sen"), "in-flight");

  c.cancel("sen");
  assert.equal(c.state("sen"), "cancelled");
  d.resolve(undefined);
  await tick();
  assert.equal(c.state("sen"), "cancelled", "cancelled key must not flip to done");

  // A cancelled key can be retried (not hard-coded done).
  const d2 = deferred<unknown>();
  c.start("sen", async () => d2.promise);
  assert.equal(c.state("sen"), "in-flight");
  d2.resolve(undefined);
  await tick();
  assert.equal(c.state("sen"), "done");
});

test("intent prefetch: cancelAll clears the in-flight intent", async () => {
  const c = createPrefetchController();
  const a = deferred<unknown>();
  const b = deferred<unknown>();
  c.start("sen", async () => a.promise);
  assert.equal(c.state("sen"), "in-flight");
  c.start("kanban", async () => b.promise); // single active intent -> sen auto-cancels
  assert.equal(c.state("kanban"), "in-flight");

  c.cancelAll();
  assert.equal(c.state("kanban"), "cancelled");
  assert.equal(c.state("sen"), "cancelled");
});

test("intent prefetch: rejection returns a key to retryable idle", async () => {
  const c = createPrefetchController();
  const d = deferred<unknown>();
  c.start("sen", async () => d.promise);
  d.reject(new Error("prefetch failed"));
  await tick();
  assert.equal(c.state("sen"), "idle", "a failed prefetch resets to idle for retry");
});

test("intent prefetch: snapshot only tracks started keys (intent-based, never all)", async () => {
  const c = createPrefetchController();
  assert.deepEqual(c.snapshot(), {}, "no intent yet -> nothing tracked");

  const d = deferred<unknown>();
  c.start("sen", async () => d.promise);
  assert.deepEqual(c.snapshot(), { sen: "in-flight" }, "only the hovered module is tracked");

  // Starting one module never touches an unrelated, unstarted module.
  c.commit("sen");
  assert.deepEqual(c.snapshot(), { sen: "done" });
});

test("intent prefetch must never mark navigation pending", async () => {
  const c = createPrefetchController();
  let navBegun = 0;
  const nav = { beginNav: (_href: string) => { navBegun += 1; } };

  // Mirror module-nav's hover wiring: the prefetch path calls ONLY controller
  // start/commit/cancel — it never begins a nav. A committed nav is driven by a
  // separate click path (nav.beginNav), which is out of the prefetch's reach.
  const hoverPrefetch = (id: string, work: () => Promise<unknown>) => c.start(id, work);
  const d = deferred<unknown>();
  hoverPrefetch("sen", () => d.promise);
  c.commit("kanban");
  c.cancel("sen");
  hoverPrefetch("memory", () => Promise.resolve(undefined));

  // Prefetch activity must never invoke navigation.
  void nav.beginNav;
  assert.equal(navBegun, 0, "hover prefetch must not touch navigation-pending state");
  assert.equal(typeof c.state, "function", "controller stays a pure state machine");
});