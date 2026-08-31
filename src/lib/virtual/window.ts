// Phase 19a U4 — pure virtualization geometry + list policy.
//
// The reusable windowing engine behind the production `VirtualList` renderer.
// It is the extraction of the windowing algorithm proven in the Phase 19a U0
// fixture (LongListFixture): a cumulative start-offset table drives a binary
// search so DOM stays a small mounted window of the logical row count for BOTH
// fixed-height and variable-height lists — zero unbounded list DOM.
//
// Everything here is a pure function of (offsets, scrollTop, viewport), so it
// unit-tests without a DOM and never reads window/document (SSR-safe).

/** Building block: low-bound binary search — count of offsets[k] < value. */
export function countLT(offsets: readonly number[], value: number): number {
  let lo = 0;
  let hi = offsets.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export interface RowGeometry {
  /** Row start offset from the list top (px). */
  top: number;
  /** Row height (px). */
  height: number;
}

/**
 * Build the cumulative start-offset table (length n+1, offsets[0]=0). Drives
 * correct virtualization for fixed- and variable-height rows alike. rowHeight
 * is a constant or a per-index function.
 */
export function buildOffsets(
  rowCount: number,
  rowHeight: number | ((index: number) => number),
): number[] {
  const offsets = new Array<number>(rowCount + 1);
  offsets[0] = 0;
  const height = typeof rowHeight === "function" ? rowHeight : () => rowHeight;
  for (let i = 0; i < rowCount; i++) offsets[i + 1] = offsets[i] + height(i);
  return offsets;
}

export interface VirtualWindow {
  /** First logical row index to mount. */
  start: number;
  /** One-past-the-last logical row index to mount. */
  end: number;
  /** First logical row index actually intersecting the viewport (anchor). */
  firstInView: number;
  /** Last logical row index intersecting the viewport. */
  lastInView: number;
  /** How many rows the window will mount. */
  mounted: number;
}

/** Clamped window of rows to mount for a scroll position, with overscan. */
export function windowForScroll(
  offsets: readonly number[],
  scrollTop: number,
  viewportHeight: number,
  overscan = 0,
): VirtualWindow {
  const total = offsets.length - 1;
  const maxScroll = Math.max(0, offsets[total] - viewportHeight);
  const top = Math.min(Math.max(0, scrollTop), maxScroll);
  const firstInView = Math.min(total - 1, countLT(offsets, top));
  const lastInView = Math.min(total - 1, countLT(offsets, top + viewportHeight));
  const start = Math.max(0, firstInView - overscan);
  const end = Math.min(total, lastInView + overscan);
  return { start, end, firstInView, lastInView, mounted: end - start };
}

/**
 * Split a fresh poll into rows that were NOT seen before (pure). Polling feeds
 * (activity/timeline) re-fetch the whole window; only rows whose key is new to
 * `seen` should animate. Returns the new keys and the newly-arrived items. The
 * caller owns mutating `seen` with the returned keys.
 */
export function partitionNew<T>(
  seen: ReadonlySet<string | number>,
  items: readonly T[],
  getKey: (item: T, index: number) => string | number,
): { addedKeys: Set<string | number>; newItems: T[] } {
  const addedKeys = new Set<string | number>();
  const newItems: T[] = [];
  for (let i = 0; i < items.length; i++) {
    const k = getKey(items[i], i);
    if (seen.has(k)) continue;
    if (!addedKeys.has(k)) {
      addedKeys.add(k);
      newItems.push(items[i]);
    }
  }
  return { addedKeys, newItems };
}

/**
 * The index of the first row intersecting the viewport top edge (the row that
 * CONTAINS the top scan line — one before you'd get by scanning past it). Used
 * by pull-based anchors so restore lands the exact straddling row.
 */
export function firstVisibleIndex(offsets: readonly number[], scrollTop: number): number {
  return Math.max(0, countLT(offsets, scrollTop + 1) - 1);
}

/** Row geometry for index `i` (top + height) from an offset table. */
export function rowAt(offsets: readonly number[], i: number): RowGeometry {
  return { top: offsets[i], height: offsets[i + 1] - offsets[i] };
}

/**
 * Pull-based scroll anchor (aligns with the view-session memento contract:
 * restore is pull-based so virtual lists paint from the correct anchor).
 *
 * `captureAnchor` records which logical row is first-in-view and how far it sits
 * below the viewport top. `restoreScrollTop` inverts that so the SAME entity
 * row lands at the SAME viewport offset after a cache/memento restore — the row
 * keeps its hitscan position even if item heights/count shifted upstream.
 */
export interface ScrollAnchor {
  firstInView: number;
  /** The anchor row's start offset at capture time. */
  anchorOffset: number;
  /** How far the anchor row is below the viewport top (px, >= 0). */
  anchorDelta: number;
}

export function captureAnchor(offsets: readonly number[], scrollTop: number): ScrollAnchor {
  const firstInView = firstVisibleIndex(offsets, scrollTop);
  return {
    firstInView,
    anchorOffset: offsets[firstInView],
    anchorDelta: Math.max(0, scrollTop - offsets[firstInView]),
  };
}

/** Restore a scrollTop that pulls the captured anchor row back to its delta. */
export function restoreScrollTop(offsets: readonly number[], anchor: ScrollAnchor): number {
  return offsets[anchor.firstInView] + anchor.anchorDelta;
}

/**
 * Classify an update's urgency for commit scheduling. Urgent feedback
 * (pointer/focus/input/scroll) stays synchronous; non-urgent derived work
 * (filter/layout/summary/selection) is eligible to rerender as a React
 * transition so the interaction lane is never starved. Pure + total.
 */
export type VirtualUpdateKind =
  | "scroll"
  | "input"
  | "pointer"
  | "focus"
  | "filter"
  | "layout"
  | "summary"
  | "selection"
  | "unknown";

export function isUrgent(kind: VirtualUpdateKind): boolean {
  return kind === "scroll" || kind === "input" || kind === "pointer" || kind === "focus";
}

/**
 * Roving-tabindex listbox keyboard policy (pure). Returns the next active index
 * for a keypress over a listbox of `total` rows, given the current active index
 * and a page size. Returns null for keys the listbox does not own (so the
 * caller can defer to default behavior / type-ahead).
 */
export function nextRowIndex(
  key: "ArrowDown" | "ArrowUp" | "Home" | "End" | "PageDown" | "PageUp",
  activeIndex: number,
  total: number,
  pageSize: number,
): number | null {
  if (total <= 0) return null;
  const last = total - 1;
  let next = activeIndex;
  switch (key) {
    case "ArrowDown":
      next = Math.min(last, next + 1);
      break;
    case "ArrowUp":
      next = Math.max(0, next - 1);
      break;
    case "PageDown":
      next = Math.min(last, next + Math.max(1, pageSize));
      break;
    case "PageUp":
      next = Math.max(0, next - Math.max(1, pageSize));
      break;
    case "Home":
      next = 0;
      break;
    case "End":
      next = last;
      break;
    default:
      return null;
  }
  if (next === activeIndex) return activeIndex;
  return next;
}