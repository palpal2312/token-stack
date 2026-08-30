// Phase 19a U4 #2 — small adapter over the reusable production `VirtualList` for
// the REAL production lists (conversation / sessions / kanban columns / activity).
//
// It keeps each view's existing item renderer living in one place and gives it a
// windowed read: below `threshold` rows it renders in plain document flow with the
// caller's EXACT existing markup (byte-equivalent to the un-virtualized view, so
// empty/small lists behave identically); at/above `threshold` it renders the same
// renderer through `VirtualList`, bounding DOM to the mounted window.
//
// The only thing the view must supply is an ESTIMATE of each row's height (px)
// for the windowing offset table. Estimates are a heuristic, not measurement —
// tall rows can clip against their estimate cell at scale. That is the deliberate
// ceiling this adapter accepts so long transcripts/large boards bound their DOM;
// when per-row measurement is ever required, swap `estimateRowHeight` for a
// measure-on-mount table keyed by `getKey`.

"use client";

import { Fragment, useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject, type ReactNode } from "react";
import { VirtualList } from "./VirtualList";

export interface VirtualizedRenderCtx<T> {
  item: T;
  index: number;
  selected: boolean;
  active: boolean;
}

const DEFAULT_VIEWPORT_H = 560;
const DEFAULT_THRESHOLD = 60;
const DEFAULT_OVERSCAN = 10;
const STICK_PX = 64;

export interface VirtualizedListProps<T> {
  items: readonly T[];
  getKey: (item: T, index: number) => string | number;
  /** Estimated px height per row for the windowing offset table (variable ok). */
  estimateRowHeight: (item: T, index: number) => number;
  ariaLabel: string;
  renderItem: (ctx: VirtualizedRenderCtx<T>) => ReactNode;
  /** Below this many rows, render in plain flow (unchanged small-list markup). */
  threshold?: number;
  /** Rendered (inside the scroll container) when there are zero items. */
  emptyContent?: ReactNode;
  overscan?: number;
  className?: string;
  containerTestId?: string;
  rowTestId?: string;
  selectedKeys?: ReadonlySet<string | number>;
  onSelect?: (key: string | number) => void;
  initialScrollTop?: number;
  onScrollTopChange?: (scrollTop: number) => void;
  /** Keep the viewport pinned to the bottom as rows append (chat/activity tails). */
  stickToBottom?: boolean;
  /** Style on the flex-fill measuring container. */
  style?: CSSProperties;
  /** Forward the scroll viewport element (auto-scroll-to-bottom / tests). */
  scrollRef?: MutableRefObject<HTMLDivElement | null>;
  /**
   * Plain-path height policy. "fill" bounds the plain scroll container to the
   * measured viewport height (chat/sessions/activity, which scroll within a
   * flex-fill region); omit for lists whose small state should grow naturally
   * (kanban columns — the grid scrolls, not the column).
   */
  plainHeight?: "fill" | number;
}

export function VirtualizedList<T>(props: VirtualizedListProps<T>) {
  const {
    items,
    getKey,
    estimateRowHeight,
    ariaLabel,
    renderItem,
    threshold = DEFAULT_THRESHOLD,
    emptyContent,
    overscan = DEFAULT_OVERSCAN,
    className,
    containerTestId,
    rowTestId,
    selectedKeys,
    onSelect,
    initialScrollTop,
    onScrollTopChange,
    stickToBottom = false,
    style,
    scrollRef,
    plainHeight,
  } = props;

  // Production containers are flex-fill, not fixed-height: measure the wrapper.
  const outerRef = useRef<HTMLDivElement | null>(null);
  const [viewportH, setViewportH] = useState(DEFAULT_VIEWPORT_H);
  useLayoutEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const apply = () => setViewportH(Math.max(80, el.clientHeight || DEFAULT_VIEWPORT_H));
    apply();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(apply) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);

  // Keep the tail in view as rows append (windowing removes the natural
  // "space-y pushes content down" of plain flow, so sticky-bottom is explicit).
  // Only stick when the user is already at/near the bottom — if they scrolled up
  // to read history, a new appended row must NOT yank them down (pull-based
  // scroll anchor). The scroll listener keeps a live near-bottom bitmap.
  const itemCount = items.length;
  const lastCountRef = useRef(itemCount);
  const wasNearBottomRef = useRef(true);
  // Scroll a sticky-bottom list to the tail on mount (a fresh session/stream
  // opens at the newest rows). Consumers that want this per entity key the list
  // by that entity id so a swap remounts and re-pins to the bottom.
  useLayoutEffect(() => {
    if (!stickToBottom || itemCount === 0) return;
    const el = scrollRef?.current ?? null;
    if (el) el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stickToBottom]);
  useLayoutEffect(() => {
    const el = scrollRef?.current ?? null;
    if (!el) return;
    const mark = () => {
      wasNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
    };
    mark();
    el.addEventListener("scroll", mark, { passive: true });
    return () => el.removeEventListener("scroll", mark);
  }, [scrollRef, itemCount]);
  useLayoutEffect(() => {
    if (!stickToBottom || itemCount <= lastCountRef.current) {
      lastCountRef.current = itemCount;
      return;
    }
    lastCountRef.current = itemCount;
    if (!wasNearBottomRef.current) return; // user scrolled up — preserve the anchor
    const el = scrollRef?.current ?? outerRef.current?.querySelector?.("[data-virtual-list]") as HTMLDivElement | null;
    if (el) el.scrollTop = el.scrollHeight;
  }, [itemCount, stickToBottom, scrollRef]);

  const rowHeight = useCallback((i: number) => estimateRowHeight(items[i], i), [items, estimateRowHeight]);

  // Small list: render the caller's markup in plain flow (identical to before),
  // on a scroll container that keeps the same class so visuals match.
  if (items.length === 0) {
    return (
      <div ref={outerRef} style={{ minHeight: 0, ...style }}>
        <div
          ref={scrollRef}
          className={className}
          data-simple-list
          {...(containerTestId ? { "data-testid": containerTestId } : {})}
        >
          {emptyContent}
        </div>
      </div>
    );
  }
  const plainHeightPx = plainHeight === "fill" ? viewportH : (typeof plainHeight === "number" ? plainHeight : undefined);
  if (items.length < threshold) {
    return (
      <div ref={outerRef} style={{ minHeight: 0, ...style }}>
        <div
          ref={scrollRef}
          className={className}
          data-simple-list
          style={plainHeightPx !== undefined ? { height: plainHeightPx } : undefined}
          {...(containerTestId ? { "data-testid": containerTestId } : {})}
        >
          {items.map((item, i) => {
            const key = getKey(item, i);
            const selected = !!selectedKeys?.has(key);
            return (
              <Fragment key={key}>
                {renderItem({ item, index: i, selected, active: false })}
              </Fragment>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div ref={outerRef} style={{ minHeight: 0, ...style }}>
      <VirtualList<T>
        scrollRef={scrollRef}
        items={items}
        getKey={getKey}
        rowHeight={rowHeight}
        height={viewportH}
        overscan={overscan}
        ariaLabel={ariaLabel}
        selectedKeys={selectedKeys}
        onSelect={onSelect}
        initialScrollTop={initialScrollTop}
        onScrollTopChange={onScrollTopChange}
        className={className}
        containerTestId={containerTestId}
        rowTestId={rowTestId}
        renderRow={({ item, index, selected, active }) =>
          renderItem({ item, index, selected, active })
        }
      />
    </div>
  );
}