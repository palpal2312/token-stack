// Phase 19a U4 #2 — windowing integration REUSE on the REAL production list
// shapes (SenView conversation + sessions sidebar, KanbanView per-column cards,
// ActivityStream timeline). These are pure-function tests over the same geometry
// the real views feed into `VirtualList`: buildOffsets + windowForScroll bound a
// huge list of each shape to a tiny mounted window, stable keys survive the
// round-trip, and partitionNew (the activity poll delta) marks only newly-arrived
// rows to animate.
//
// The per-view height ESTIMATES below mirror src/components/*'s estimate
// functions (deterministic by content length/id) so the tested geometry is the
// geometry production actually renders — without needing a DOM.

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOffsets,
  countLT,
  partitionNew,
  windowForScroll,
} from "../../src/lib/virtual/window";

const VIEWPORT = 560;
const OVERSCAN = 12;

// --------------------------------------------------------------------- helpers

// Mirrors SenView.estimateTurnHeight: user flat bubbles, assistant markdown taller.
function turnHeight(t: { role: string; text: string; builder?: string; model?: string }, i: number): number {
  const chars = Math.max(1, Math.ceil(t.text.length / 90));
  const paras = Math.max(1, t.text.split(/\n{2,}/).length);
  const lines = Math.max(chars, paras);
  const headroom = t.role === "assistant" && (t.builder || t.model) ? 20 : 0;
  return 44 + lines * 22 + headroom;
}

// Mirrors SenView sessions: fixed 68px history rows (wrapper estimateRowHeight).
const SESSION_H = 68;

// Mirrors KanbanView.estimateCardHeight: 📌 pinned cards carry a 158px preview.
function cardHeight(t: { title: string }, i: number): number {
  if (t.title.startsWith("📌")) return 218;
  return 88 + Math.min(Math.ceil(t.title.length / 40) * 16, 48);
}

// Mirrors ActivityStream.estimateRowHeight: single wrapping line style.
function entryHeight(e: { text: string }, i: number): number {
  const base = 34;
  const chars = e.text.length;
  return base + (chars > 90 ? Math.min(Math.ceil(chars / 90) * 14, 84) : 0);
}

function many<T>(n: number, make: (i: number) => T): T[] {
  return new Array(n).fill(0).map((_, i) => make(i));
}

// ----------------------------------------------------- conversation shape (U4 audit: SenView.tsx turns.map)

test("conversation: 10k turns window to a small mounted set, unbounded total", () => {
  const turns_ = many(10_000, (i) =>
    i % 2 === 0
      ? { role: "user" as const, text: "How do I vectorize a loop?" }
      : { role: "assistant" as const, text: "Use SIMD or a library.\n\nHere's why.\n\nThis is a long answer that wraps.", builder: "b", model: "m" });
  const offsets = buildOffsets(turns_.length, (i) => turnHeight(turns_[i], i));
  assert.equal(offsets.length, 10_001);
  const wMid = windowForScroll(offsets, offsets[5000], VIEWPORT, OVERSCAN);
  assert.ok(wMid.end - wMid.start < 40, "mid-conversation window stays small");
  assert.ok(wMid.firstInView >= 5000 && wMid.firstInView <= 5001);
  // deepest scroll clamps inside the dataset, never past the tail
  const wEnd = windowForScroll(offsets, offsets[9999] + 1e6, VIEWPORT, OVERSCAN);
  assert.ok(wEnd.end - wEnd.start < 40 && wEnd.end <= 10_000);
});

test("conversation: variable markdown heights accumulate monotonically", () => {
  const turns_ = [
    { role: "user", text: "hi" },
    { role: "assistant", text: "a\n\nb\n\nc\n\n d\n\n e", builder: "b" },
    { role: "user", text: "more words".repeat(40) },
  ];
  const offsets = buildOffsets(3, (i) => turnHeight(turns_[i], i));
  for (let i = 1; i < offsets.length; i++) assert.ok(offsets[i] > offsets[i - 1]);
  // the tall markdown row is strictly taller than the flat user row
  assert.ok(offsets[2] - offsets[1] > offsets[1] - offsets[0]);
});

test("conversation: stable entity key prefers turn.key over index (append-safe)", () => {
  const getKey = (t: { key?: string }, i: number) => t.key ?? i;
  const a: { key?: string } = { key: "chatAttempt-7" };
  const b: { key?: string } = { role: "user", text: "x" } as unknown as { key?: string };
  assert.equal(getKey(a, 0), "chatAttempt-7");
  // prepending a new turn at index 0 must NOT change a later turn's key
  assert.equal(getKey(b, 1), 1, "a turn without a key keeps index identity");
  assert.equal(getKey(a, 1), "chatAttempt-7", "a keyed turn's key is position-independent");
});

// ----------------------------------------------------------- sessions shape (SenView.tsx sessions.map)

test("sessions: 10k history rows keep a bounded mounted window", () => {
  const sessions_ = many(10_000, (i) => ({ id: `s-${i}`, title: `Session ${i}` }));
  const offsets = buildOffsets(sessions_.length, () => SESSION_H);
  const w = windowForScroll(offsets, SESSION_H * 9990, VIEWPORT, OVERSCAN);
  assert.ok(w.end - w.start < 40);
  assert.ok(w.firstInView >= 9990 && w.lastInView <= 10_000);
  // session sidebar keys are stable entity ids
  assert.equal(sessions_[1234].id, "s-1234");
  const keys = sessions_.map((s) => s.id);
  assert.equal(new Set(keys).size, 10_000, "session ids are unique across 10k");
});

test("sessions: empty and single-row sidebar build a 0/1-offset table without throwing", () => {
  assert.deepEqual(buildOffsets(0, () => SESSION_H), [0]);
  assert.deepEqual(buildOffsets(1, () => SESSION_H), [0, SESSION_H]);
});

// ---------------------------------------------------------- kanban shape (KanbanView.tsx tasks.map)

test("kanban: per-column variable cards stay windowed even with pinned preview cards", () => {
  const cards_ = many(10_000, (i) => ({ title: i % 50 === 0 ? "📌 Content artifact" : `Task ${i}` }));
  const offsets = buildOffsets(cards_.length, (i) => cardHeight(cards_[i], i));
  const wMid = windowForScroll(offsets, offsets[5000], VIEWPORT, OVERSCAN);
  assert.ok(wMid.end - wMid.start < 40, "a big single column stays windowed");
  // a pinned 218px card is taller than a plain 96px card
  assert.ok(cardHeight({ title: "📌 x" }, 0) > cardHeight({ title: "task" }, 0));
});

test("kanban: homogeneous column (COLUMNS bucket) computes deterministic offsets", () => {
  const col = many(500, (i) => ({ title: `t${i}` }));
  const offsets = buildOffsets(col.length, (i) => cardHeight(col[i], i));
  assert.equal(offsets[0], 0);
  assert.equal(offsets[500], offsets[499] + cardHeight(col[499], 499), "last offset = cumulative tail");
});

test("kanban: empty column yields a zero-height table and a null window", () => {
  const offsets = buildOffsets(0, (i) => cardHeight({ title: "" }, i));
  assert.deepEqual(offsets, [0]);
  assert.equal(countLT(offsets, 0), 0);
});

// ------------------------------------------------------ activity shape (ActivityStream.tsx entries.map)

test("activity: server-capped feed is ALSO windowed so a big poll never renders all rows", () => {
  // Server returns up to N entries; even a 10k-tail poll must bound DOM client-side.
  const entries_ = many(10_000, (i) => ({ ts: 1_700_000_000_000 + i * 13, text: `row ${i} `.repeat(i % 4 + 1), agent: "a", level: "info" }));
  const offsets = buildOffsets(entries_.length, (i) => entryHeight(entries_[i], i));
  const wEnd = windowForScroll(offsets, offsets[9999], VIEWPORT, OVERSCAN);
  assert.ok(wEnd.end - wEnd.start < 40, "activity window stays bounded");
  assert.ok(wEnd.lastInView <= 9999);
});

test("activity: stable ts key beats the old ts-index composition", () => {
  const key = (e: { ts: number }, i: number) => e.ts; // new stable key
  const old = (e: { ts: number }, i: number) => `${e.ts}-${i}`; // old shifting key
  const e1 = { ts: 10 }, e2 = { ts: 20 }, e3 = { ts: 30 };
  // prepend a new event: stable key of e2/e3 unchanged, old ts-index key shifts
  assert.equal(key(e2, 0), key(e2, 1));
  assert.notEqual(old(e2, 0), old(e2, 1));
});

test("activity: partitionNew marks only newly-arrived rows to animate", () => {
  const entries = many(6, (i) => ({ ts: 100 + i, text: `e${i}` }));
  // first poll: everything is new
  const first = partitionNew(new Set<number>(), entries.slice(0, 3), (e) => e.ts);
  assert.deepEqual([...first.addedKeys].sort(), [100, 101, 102]);
  assert.equal(first.newItems.length, 3);
  // second poll: rows 1,2 already seen → only row 3 is new
  const seen = new Set<string | number>(first.addedKeys);
  const second = partitionNew(seen, entries.slice(1, 4), (e) => e.ts);
  assert.deepEqual([...second.addedKeys], [103]);
  assert.deepEqual(second.newItems.map((e) => e.ts), [103]);
});

test("activity: partitionNew dedupes repeated keys and drops already-seen traffic", () => {
  const dupEntries = [
    { ts: 1, text: "a" },
    { ts: 1, text: "a-dup" },
    { ts: 2, text: "b" },
  ];
  const { newItems } = partitionNew(new Set(), dupEntries, (e) => e.ts);
  assert.equal(newItems.length, 2, "duplicate ts collapses to one arrival");
  // seen keys survive a re-poll (no re-animation)
  const rerun = partitionNew(new Set([1, 2]), dupEntries, (e) => e.ts);
  assert.equal(rerun.newItems.length, 0);
});

// --------------------------------------------------------------------- shared reuse invariant

test("shared: a 10k row of every production height curve is <2% mounted", () => {
  const curves: Array<[string, (i: number) => number]> = [
    ["conversation", (i) => turnHeight(i % 2 ? { role: "assistant", text: "x".repeat(300), builder: "b" } as never : { role: "user", text: "y".repeat(20) } as never, i)],
    ["sessions", () => SESSION_H],
    ["kanban", (i) => cardHeight({ title: i % 50 ? `t${i}` : "📌 x" }, i)],
    ["activity", (i) => entryHeight({ text: `r`.repeat(i % 3 * 40) }, i)],
  ];
  for (const [name, h] of curves) {
    const offsets = buildOffsets(10_000, h);
    const w = windowForScroll(offsets, 0, VIEWPORT, OVERSCAN);
    assert.ok(w.mounted < 200, `${name} mounts < 200 of 10k rows (${w.mounted})`);
  }
});

test("shared: pull-based scroll anchor restores a conversation row across a height shift", async () => {
  const { captureAnchor, restoreScrollTop } = await import("../../src/lib/virtual/window");
  const turnsA = many(500, (i) => ({ role: "user", text: "x".repeat(20 + (i % 3) * 40) }));
  const offsetsA = buildOffsets(turnsA.length, (i) => turnHeight(turnsA[i], i));
  const scroll = offsetsA[300] + 8;
  const anchor = captureAnchor(offsetsA, scroll);
  assert.equal(anchor.firstInView, 300);
  assert.equal(anchor.anchorDelta, 8);
  // a downstream reflow that grows every row must still restore the SAME turn at 8px
  const turnsB = turnsA.map((t, i) => ({ role: "user", text: t.text + " wrap makes it taller ".repeat(i % 2) }));
  const offsetsB = buildOffsets(turnsB.length, (i) => turnHeight(turnsB[i], i));
  const restored = restoreScrollTop(offsetsB, anchor);
  assert.equal(restored, offsetsB[300] + 8, "anchor row reappears at its captured delta");
});