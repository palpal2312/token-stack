import assert from "node:assert/strict";
import test from "node:test";
import { queryKeys, type QueryKey } from "../../src/lib/query/query-keys";
import { QueryClient } from "../../src/lib/query/query-cache";
import {
  RealtimeReconciler,
  REFETCH_BASE_BACKOFF_MS,
} from "../../src/lib/query/realtime-reconciler";

/**
 * Phase 19a U3 — realtime reconciler (custom, library-free). Pure rules tests
 * against the typed key factories with an injectable clock and a fake canonical
 * fetcher, mirroring the established node:test + tsx runner and
 * phase-19a-u3-query-cache.spec.ts.
 */

/** Deterministic clock. */
function makeClock(initial = 0) {
  let t = initial;
  return {
    now: () => t,
    advance: (ms: number) => { t += ms; },
  };
}

const ws = "wsA";
const wsThread = (session = "s1") => queryKeys.thread.detail(ws, session);

/** A canonical fetcher that records per-key calls and returns `next`. */
function canonicalFetcher(calls: QueryKey[] = []) {
  return async (key: QueryKey) => {
    calls.push(key);
    return { canonical: true, key: key[key.length - 1] };
  };
}

/** Drain one macrotask so queued (serialized) writes/replaces settle. */
function flushAsync(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

test("duplicate / replayed delta seq -> no-op, never double-applies", () => {
  const client = new QueryClient();
  const r = new RealtimeReconciler({ workspaceId: ws, client });
  const k = wsThread();

  assert.equal(r.applyCommittedDelta({ workspaceId: ws, seq: 1, data: [{ key: k, value: { v: 1 } }] }), "applied");
  assert.deepEqual(client.getData(k), { v: 1 }, "first apply writes the cache");

  // Replaying the SAME event/seq is a no-op: no write, still "duplicate".
  assert.equal(r.applyCommittedDelta({ workspaceId: ws, seq: 1, data: [{ key: k, value: { v: 1 } }] }), "duplicate");
  // An earlier/older seq is equally a no-op.
  assert.equal(r.applyCommittedDelta({ workspaceId: ws, seq: 0, data: [{ key: k, value: { v: 0 } }] }), "duplicate");

  assert.deepEqual(client.getData(k), { v: 1 }, "replayed deltas never overwrite or re-patch");
  assert.equal(r.detectGap(1), false, "a duplicate is not a gap");
});

test("out-of-order delta -> gap detected + immediate canonical replace scheduled", () => {
  const client = new QueryClient();
  const r = new RealtimeReconciler({ workspaceId: ws, client, now: () => 1000 });
  const k = wsThread();

  r.applyCommittedDelta({ workspaceId: ws, seq: 1, data: [{ key: k, value: { v: 1 } }] });
  assert.equal(r.detectGap(3), true, "a forward discontinuity is a gap");

  const outcome = r.applyCommittedDelta({ workspaceId: ws, seq: 3, data: [{ key: k, value: { v: 3 } }] });
  assert.equal(outcome, "gap");
  assert.equal(client.getData(k), undefined, "gap delta is NOT applied (cache requeued/held)");

  const entries = r.scheduledEntries();
  assert.equal(entries.length, 1, "gap schedules exactly one refetch");
  assert.equal(entries[0].cause, "gap");
  assert.equal(entries[0].delayMs, 0, "gap is scheduled immediately, not on backoff");
  assert.equal(entries[0].dueAt, 1000, "immediate gap is due at t=0 of the injected clock");
  assert.deepEqual(entries[0].keys, [k], "the affected key is scheduled for canonical replace");
});

test("gap while offline -> reconnect replaceFromCanonical marks the key stale then restores", async () => {
  const { now } = makeClock(0);
  const client = new QueryClient({ now });
  const r = new RealtimeReconciler({
    workspaceId: ws,
    client,
    now,
    canonicalRefetch: async () => { throw new Error("offline"); },
  });
  const k = wsThread();

  r.applyCommittedDelta({ workspaceId: ws, seq: 1, data: [{ key: k, value: { v: 1 } }] });

  // A gap arrives while the channel is down (offline).
  r.applyCommittedDelta({ workspaceId: ws, seq: 5, data: [{ key: k, value: { v: 5 } }] });
  assert.equal(client.getData(k), undefined, "offline gap requeues the key (drops stale data)");
  assert.equal(
    r.scheduledEntries().some((e) => e.cause === "gap" && e.keys[0] === k),
    true,
    "gap is scheduled so the reconnect drain knows what to restore",
  );

  // Intervening deltas are also held until canonical restore.
  assert.equal(
    r.applyCommittedDelta({ workspaceId: ws, seq: 6, data: [{ key: k, value: { v: 6 } }] }),
    "gap",
    "deltas keep surfacing as gap while awaiting canonical",
  );

  // Reconnect: the reconnect handler calls replaceFromCanonical — first requeues
  // (marks stale) the affected key, then atomically restores it from canonical.
  const calls: QueryKey[] = [];
  await r.replaceFromCanonical([k], canonicalFetcher(calls));
  assert.equal(calls[0], k, "replace refetches the affected key from canonical");
  assert.deepEqual(
    client.getData(k),
    { canonical: true, key: "thread" },
    "key is replaced by canonical, not the gap delta",
  );

  // A fully-contiguous delta resumes applying after the canonical restore.
  const next = queryKeys.thread.detail(ws, "s2");
  assert.equal(
    r.applyCommittedDelta({ workspaceId: ws, seq: 7, data: [{ key: next, value: { v: 7 } }] }),
    "applied",
    "healthy stream resumes after reconnect",
  );
  assert.deepEqual(client.getData(next), { v: 7 });
});

test("applied deltas serialize ahead of a replace — no partial merge", async () => {
  const client = new QueryClient();
  const r = new RealtimeReconciler({ workspaceId: ws, client });
  const k = wsThread();

  // Two contiguous deltas apply first, synchronously.
  r.applyCommittedDelta({ workspaceId: ws, seq: 1, data: [{ key: k, value: { a: 1 } }] });
  r.applyCommittedDelta({ workspaceId: ws, seq: 2, data: [{ key: k, value: { a: 2 } }] });
  assert.deepEqual(client.getData(k), { a: 2 }, "both deltas are applied ahead of the replace");

  // Start an authoritative replace with a slow canonical fetch.
  let releaseCanonical!: () => void;
  const gate = new Promise<void>((res) => { releaseCanonical = res; });
  let canonicalCalls = 0;
  const replacePromise = r.replaceFromCanonical([k], async () => {
    canonicalCalls += 1;
    await gate; // canonical fetch is in flight
    return { a: "canonical" }; // a fully different shape from the deltas
  });

  // A delta arrives WHILE the replace is outstanding.
  const midOutcome = r.applyCommittedDelta({ workspaceId: ws, seq: 3, data: [{ key: k, value: { z: 3 } }] });
  assert.equal(midOutcome, "applied", "a delta can still advance the seq while a replace is in flight");

  releaseCanonical();
  await replacePromise;
  await flushAsync(); // let the queued delta write settle behind the replace

  assert.equal(canonicalCalls, 1, "the canonical refetch ran exactly once (atomic)");
  assert.deepEqual(
    client.getData(k),
    { z: 3 },
    "the in-flight delta lands as ONE complete committed unit on top of the snapshot — " +
      "never a hybrid partial merge of canonical + delta fields",
  );
});

test("register is idempotent per workspace — no duplicate global listeners, teardown idempotent", () => {
  const client = new QueryClient();
  const r = new RealtimeReconciler({ workspaceId: ws, client });

  assert.equal(r.listeners(), 0, "no channel before register");

  const t1 = r.register();
  assert.equal(r.listeners(), 1, "exactly one channel after first register");

  // A duplicate register() must NOT add a second global listener.
  const t2 = r.register();
  assert.equal(r.listeners(), 1, "repeat register never adds a duplicate listener");

  // Teardown is per-registration; the channel survives until the last one.
  t2();
  assert.equal(r.listeners(), 1, "channel stays after one of two registrations tears down");
  t1();
  assert.equal(r.listeners(), 0, "channel closes when the last registration tears down");

  // Register is fully re-entrant after teardown.
  const t3 = r.register();
  assert.equal(r.listeners(), 1, "channel can be re-opened after full teardown");
  t3();
  assert.equal(r.listeners(), 0);
});

test("transient refetch uses exponential backoff while a gap is immediate", () => {
  const { now } = makeClock(0);
  const client = new QueryClient({ now });
  const r = new RealtimeReconciler({ workspaceId: ws, client, now });

  const transient1 = r.scheduleRefetch({ cause: "transient" });
  assert.equal(transient1.delayMs, REFETCH_BASE_BACKOFF_MS, "first transient retry is the base");

  r.scheduleRefetch({ cause: "transient" });
  r.scheduleRefetch({ cause: "transient" });
  const transient4 = r.scheduleRefetch({ cause: "transient" });
  assert.equal(
    transient4.delayMs,
    REFETCH_BASE_BACKOFF_MS * 8,
    "transient delays escalate exponentially",
  );

  // A gap is always immediate regardless of prior transient backoff.
  const gap = r.scheduleRefetch({ cause: "gap" });
  assert.equal(gap.delayMs, 0, "gap scheduling is never backoff-stratified");
});

/** drainScheduled with no due entries returns 0 and does not advance state. */
test("drain with nothing due is a no-op", async () => {
  const { now } = makeClock(50);
  const client = new QueryClient({ now });
  const r = new RealtimeReconciler({ workspaceId: ws, client, now });
  r.scheduleRefetch({ cause: "transient" }); // base 250ms -> due at 300
  assert.equal(await r.drainScheduled(now()), 0, "not yet due -> nothing drained");
});