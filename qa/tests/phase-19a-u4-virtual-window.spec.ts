import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOffsets,
  captureAnchor,
  countLT,
  firstVisibleIndex,
  isUrgent,
  nextRowIndex,
  restoreScrollTop,
  rowAt,
  windowForScroll,
} from "../../src/lib/virtual/window";

test("window: buildOffsets builds a cumulative start-offset table (fixed + variable height)", () => {
  // fixed 44px x 3
  assert.deepEqual(buildOffsets(3, 44), [0, 44, 88, 132]);
  // variable: heights [40, 60, 20]
  assert.deepEqual(buildOffsets(3, (i) => [40, 60, 20][i]), [0, 40, 100, 120]);
});

test("window: countLT binary search returns the index strictly greater at the boundary", () => {
  const offsets = buildOffsets(5, 44); // 0,44,88,132,176,220
  assert.equal(countLT(offsets, 0), 0); // row 0 starts at 0, not below it
  assert.equal(countLT(offsets, 44), 1); // scrollTop exactly at row1 start
  assert.equal(countLT(offsets, 87), 2); // inside row 1; rows 0,1 start below 87
  assert.equal(countLT(offsets, 219), 5); // inside row 4; rows 0..4 start below 219
});

test("window: firstVisibleIndex is the row straddling the viewport top", () => {
  const offsets = buildOffsets(5, 44);
  assert.equal(firstVisibleIndex(offsets, 0), 0);
  assert.equal(firstVisibleIndex(offsets, 44), 1, "on a row start, that row is first");
  assert.equal(firstVisibleIndex(offsets, 98), 2, "row 2 (starts 88) contains 98");
});

test("window: windowForScroll clamps to the dataset and bounds the mounted window", () => {
  const offsets = buildOffsets(10_000, 44);
  const wTop = windowForScroll(offsets, 0, 560, 12);
  assert.equal(wTop.start, 0);
  assert.equal(wTop.lastInView, 13); // rows 0..12 within 560px; offset of row13 > 560
  assert.equal(wTop.end, 13 + 12); // lastInView + overscan (25-row window, matches U0)
  assert.equal(wTop.mounted, 25);

  // mid-list
  const wMid = windowForScroll(offsets, 44 * 5000, 560, 12);
  assert.equal(wMid.firstInView, 5000);
  assert.equal(wMid.start, 5000 - 12);
  assert.equal(wMid.end, 5013 + 12);
  assert.equal(wMid.mounted, 37);

  // deep scroll far beyond the end clamps to the last row, never out of range
  const wEnd = windowForScroll(offsets, offsets[9999] + 1_000_000, 560, 12);
  assert.ok(wEnd.lastInView <= 9999);
  assert.ok(wEnd.end <= 10_000);
  assert.equal(wEnd.end - wEnd.start, wEnd.mounted);
  assert.ok(wEnd.end - wEnd.start <= 40, "deep window stays a small fraction of 10k");
});

test("window: variable-height window maps exactly via the offset table", () => {
  const offsets = buildOffsets(10_000, (i) => 44 + (i % 7) * 6); // 44..80
  const scrollTop = offsets[4000]; // land exactly on row 4000
  const w = windowForScroll(offsets, scrollTop, 560, 0);
  assert.equal(w.firstInView, 4000, "row at its exact start offset is first-in-view");
  assert.ok(w.end > w.firstInView);
  assert.ok(w.end - w.firstInView <= Math.ceil(560 / 44) + 2, "variable window stays small");
});

test("window: rowAt reports top + height from the offset table", () => {
  const offsets = buildOffsets(4, (i) => 40 + i * 10); // 40,50,60,70
  assert.deepEqual(rowAt(offsets, 2), { top: offsets[2], height: 60 });
});

test("window: pull-based scroll anchor round-trips across a height shift", () => {
  const offsetsA = buildOffsets(5, 44);
  const scrollTop = 44 * 2 + 10; // row 2 sits 10px below the viewport top
  const anchor = captureAnchor(offsetsA, scrollTop);
  assert.equal(anchor.firstInView, 2);
  assert.equal(anchor.anchorOffset, 44 * 2);
  assert.equal(anchor.anchorDelta, 10);

  // A cache/memento restore with the SAME anchors lands the same row at the
  // same viewport offset even if upstream row heights changed before it.
  const offsetsB = buildOffsets(5, 50); // every row regrew by 6px
  const restored = restoreScrollTop(offsetsB, anchor);
  assert.equal(restored, 50 * 2 + 10, "anchor row reappears at its captured delta");
});

test("window: scroll-anchor at the very top stays zero", () => {
  const offsets = buildOffsets(3, 44);
  const anchor = captureAnchor(offsets, 0);
  assert.equal(anchor.firstInView, 0);
  assert.equal(anchor.anchorDelta, 0);
  assert.equal(restoreScrollTop(offsets, anchor), 0);
});

test("policy: urgent update kinds stay synchronous, non-urgent are transition-eligible", () => {
  for (const k of ["scroll", "input", "pointer", "focus"] as const) {
    assert.equal(isUrgent(k), true, `${k} must be urgent (sync)`);
  }
  for (const k of ["filter", "layout", "summary", "selection", "unknown"] as const) {
    assert.equal(isUrgent(k), false, `${k} must be transition-eligible`);
  }
});

test("policy: nextRowIndex roving-tabindex navigation moves within bounds", () => {
  assert.equal(nextRowIndex("ArrowDown", 0, 10_000, 12), 1);
  assert.equal(nextRowIndex("ArrowDown", 9999, 10_000, 12), 9999, "clamps at the last row");
  assert.equal(nextRowIndex("ArrowUp", 0, 10_000, 12), 0, "clamps at the first row");
  assert.equal(nextRowIndex("Home", 550, 10_000, 12), 0);
  assert.equal(nextRowIndex("End", 550, 10_000, 12), 9999);
  assert.equal(nextRowIndex("PageDown", 0, 10_000, 12), 12);
  assert.equal(nextRowIndex("PageUp", 100, 10_000, 12), 88);
  assert.equal(nextRowIndex("ArrowDown", 0, 0, 12), null, "empty list is a no-op");
});