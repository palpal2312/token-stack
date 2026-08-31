// Phase 19a U4 — reusable production virtualized list (small windowing renderer).
//
// Confines DOM to a small mounted window of the logical row count by the proven
// U0 geometry (cumulative-offset table + binary search; see src/lib/virtual/window.ts).
// Data-agnostic: the caller supplies items, a stable-key getter, row height and a
// row renderer. Preserves stable entity keys, pull-based scroll anchor (restore is
// a layout effect that repaints the viewport from the captured first-in-view row),
// selection (keyed, independent of the window), and listbox/listitem accessibility
// (roving tabindex, arrow/Home/End/PageUp/PageDown nav, aria-setsize/posinset).
//
// Commit repair baked in (per the render contract):
//   - rows are memoized and receive a STABLE onSelect identity (useCallback).
//   - urgent updates (scroll/pointer/focus/input) apply synchronously; non-urgent
//     derived work (filter/layout/summary) is scheduled as a React transition.
//   - selection/active indexes are keyed primitives on the caller, not a store
//     subscription.

"use client";

import {
  memo,
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
  type UIEvent,
} from "react";
import {
  buildOffsets,
  countLT,
  isUrgent,
  nextRowIndex,
  rowAt,
  windowForScroll,
  type VirtualUpdateKind,
} from "@/lib/virtual/window";

export interface VirtualListRenderRow<T> {
  item: T;
  index: number;
  selected: boolean;
  active: boolean;
}

export interface VirtualListProps<T> {
  items: readonly T[];
  getKey: (item: T, index: number) => string | number;
  /** A constant row height, or a function for variable-height rows. */
  rowHeight: number | ((index: number) => number);
  /** Viewport height (px). When unset the container sizes itself and scrolls. */
  height?: number;
  /** Rows mounted past the visible viewport (keeps paint ahead of the thumb). */
  overscan?: number;
  ariaLabel: string;
  renderRow: (row: VirtualListRenderRow<T>) => ReactNode;
  selectedKeys?: ReadonlySet<string | number>;
  onSelect?: (key: string | number) => void;
  /** Pull-based anchor restore: viewport repaints scrolled to this (px). */
  initialScrollTop?: number;
  /** Echo the current scrollTop for a view-session memento (stable id). */
  onScrollTopChange?: (scrollTop: number) => void;
  /** Urgency of the dominant update feeding this list (drives transitions). */
  updateKind?: VirtualUpdateKind;
  /** content-visibility: auto belt-and-suspenders on mounted rows. */
  contentVisibility?: boolean;
  className?: string;
  /** Optional data-testid applied to the container (scrollable viewport). */
  containerTestId?: string;
  /** Optional data-testid applied to each mounted row. */
  rowTestId?: string;
  /** Extra viewport CSS (merged over the default scroll container). */
  viewportStyleOverride?: React.CSSProperties;
  /** Forward the scroll viewport element (for imperative scroll-to-bottom). */
  scrollRef?: React.Ref<HTMLDivElement>;
}

const DEFAULT_VIEWPORT_H = 560;
const DEFAULT_OVERSCAN = 10;

export function VirtualList<T>(props: VirtualListProps<T>) {
  const {
    items,
    getKey,
    rowHeight,
    height = DEFAULT_VIEWPORT_H,
    overscan = DEFAULT_OVERSCAN,
    ariaLabel,
    renderRow,
    selectedKeys,
    onSelect,
    initialScrollTop,
    onScrollTopChange,
    updateKind = "scroll",
    contentVisibility = true,
    className,
    containerTestId,
    rowTestId,
    viewportStyleOverride,
    scrollRef,
  } = props;

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [activeIndex, setActiveIndexState] = useState(0);
  const lastTargetRef = useRef(-1);
  const [isPending, startTransition] = useTransition();

  // Offsets are O(n) once; the window map is O(log n) per scroll.
  const offsets = useMemo(() => buildOffsets(items.length, rowHeight), [items.length, rowHeight]);
  const window_ = windowForScroll(offsets, scrollTop, height, overscan);
  const totalHeight = offsets[items.length] ?? 0;

  // Pull-based anchor restore: repaint the viewport from the captured picture on
  // mount / memento restore, exactly as the view-session memento contract demands.
  const initialScrollTopRef = useRef(initialScrollTop);
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    if (typeof initialScrollTopRef.current === "number") {
      const target = Math.min(Math.max(0, initialScrollTopRef.current), Math.max(0, totalHeight - height));
      if (Math.abs(el.scrollTop - target) > 0.5) el.scrollTop = target;
      setScrollTop(target);
      initialScrollTopRef.current = undefined; // restore once
    }
  }, [totalHeight, height]);

  // Non-urgent windowing updates go through a transition; scroll/input stay sync.
  useLayoutEffect(() => {
    if (!isUrgent(updateKind)) return;
    const el = viewportRef.current;
    if (!el) return;
    setScrollTop(el.scrollTop);
  }, [updateKind]);

  // Stable onSelect identity (commit repair): the caller's handler is read via a
  // ref so row callbacks never invalidate across re-renders.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const handleRowSelect = useCallback((key: string | number) => {
    onSelectRef.current?.(key);
  }, []);

  const handleScroll = useCallback(
    (e: UIEvent<HTMLDivElement>) => {
      const next = e.currentTarget.scrollTop;
      // Urgent: sync. Non-urgent review/filter scrolls may rerender as a transition.
      if (isUrgent(updateKind)) setScrollTop(next);
      else startTransition(() => setScrollTop(next));
      onScrollTopChange?.(next);
    },
    [onScrollTopChange, updateKind],
  );

  // Roving-tabindex listbox keyboard nav. The pure policy computes the target
  // index; we then scroll the VIEWPORT to the target's offset (works even when
  // the target row is not yet mounted — Home/End across a 10k list) and focus
  // the freshly-mounted row via the activeIndex effect below.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!["ArrowDown", "ArrowUp", "Home", "End", "PageDown", "PageUp"].includes(e.key)) return;
      e.preventDefault();
      const pageSize = Math.max(1, Math.floor(height / (typeof rowHeight === "number" ? rowHeight : 44)));
      const current = Math.max(0, countLT(offsets, scrollTop));
      const active = lastTargetRef.current >= 0 ? lastTargetRef.current : current;
      const target = nextRowIndex(
        e.key as "ArrowDown" | "ArrowUp" | "Home" | "End" | "PageDown" | "PageUp",
        active,
        items.length,
        pageSize,
      );
      if (target === null || target === active) return;
      lastTargetRef.current = target;
      const el = viewportRef.current;
      if (el) {
        const h = typeof rowHeight === "number" ? rowHeight : rowHeight(target);
        const top = offsets[target];
        if (top < el.scrollTop) el.scrollTop = top;
        else if (top + h > el.scrollTop + height) el.scrollTop = top + h - height;
      }
      setActiveIndexState(target);
    },
    [offsets, scrollTop, height, rowHeight, items.length],
  );

  // ARIA: the listbox keeps real focus; aria-activedescendant names the active
  // option (the roving-tabindex / activedescendant listbox pattern). This keeps
  // the active row visible to screen readers WITHOUT moving DOM focus onto rows
  // (which would be dropped when the window remounts the row during scroll).
  const listId = useId();
  const activeId = activeIndex >= window_.start && activeIndex < window_.end ? `${listId}-o-${activeIndex}` : undefined;

  const viewportStyle = useMemo<React.CSSProperties>(
    () => ({ height, overflowY: "auto", position: "relative", ...(viewportStyleOverride ?? {}) }),
    [height, viewportStyleOverride],
  );
  const innerStyle = useMemo<React.CSSProperties>(() => ({ position: "relative", height: totalHeight }), [totalHeight]);

  const rows: ReactNode[] = [];
  for (let i = window_.start; i < window_.end; i++) {
    const key = getKey(items[i], i);
    const selected = !!selectedKeys?.has(key);
    const active = i === activeIndex;
    rows.push(
      <VirtualRow
        key={key}
        rowId={`${listId}-o-${i}`}
        dataKey={key}
        index={i}
        top={rowAt(offsets, i).top}
        height={rowAt(offsets, i).height}
        total={items.length}
        selected={selected}
        active={active}
        contentVisibility={contentVisibility}
        ariaLabel={ariaLabel}
        onSelect={handleRowSelect}
        rowTestId={rowTestId}
      >
        {renderRow({ item: items[i], index: i, selected, active })}
      </VirtualRow>,
    );
  }

  return (
    <div
      ref={(el) => {
        viewportRef.current = el;
        if (typeof scrollRef === "function") scrollRef(el);
        else if (scrollRef) scrollRef.current = el;
      }}
      role="listbox"
      aria-label={ariaLabel}
      aria-busy={isPending || undefined}
      aria-activedescendant={activeId}
      tabIndex={0}
      data-virtual-list
      {...(containerTestId ? { "data-testid": containerTestId } : {})}
      style={viewportStyle}
      className={className}
      onScroll={handleScroll}
      onKeyDown={handleKeyDown}
    >
      <div style={innerStyle}>{rows}</div>
    </div>
  );
}

const VirtualRow = memo(
  function VirtualRow({
    rowId,
    top,
    height,
    total,
    index,
    dataKey,
    selected,
    active,
    contentVisibility,
    ariaLabel,
    onSelect,
    rowTestId,
    children,
  }: {
    rowId: string;
    top: number;
    height: number;
    total: number;
    index: number;
    dataKey: string | number;
    selected: boolean;
    active: boolean;
    contentVisibility: boolean;
    ariaLabel: string;
    onSelect: (key: string | number) => void;
    rowTestId?: string;
    children: ReactNode;
  }) {
    const style: React.CSSProperties = {
      position: "absolute",
      left: 0,
      right: 0,
      top,
      height,
      boxSizing: "border-box",
      overflow: "hidden",
    };
    if (contentVisibility) {
      style.contentVisibility = "auto";
      style.containIntrinsicSize = `auto ${height}px`;
    }
    return (
      <div
        id={rowId}
        role="option"
        aria-selected={selected}
        aria-setsize={total}
        aria-posinset={index + 1}
        aria-label={`${ariaLabel}, item ${index + 1} of ${total}`}
        data-virtual-row
        data-key={String(dataKey)}
        data-index={index}
        data-selected={selected || undefined}
        data-active={active || undefined}
        {...(rowTestId ? { "data-testid": rowTestId } : {})}
        style={style}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onSelect(dataKey)}
      >
        {children}
      </div>
    );
  },
  (prev, next) =>
    prev.rowId === next.rowId &&
    prev.top === next.top &&
    prev.height === next.height &&
    prev.total === next.total &&
    prev.dataKey === next.dataKey &&
    prev.selected === next.selected &&
    prev.active === next.active &&
    prev.onSelect === next.onSelect,
);

// Re-export pure helpers so consumers/tests import from one place.
export {
  buildOffsets,
  captureAnchor,
  countLT,
  isUrgent,
  nextRowIndex,
  partitionNew,
  restoreScrollTop,
  rowAt,
  windowForScroll,
} from "@/lib/virtual/window";
export type { ScrollAnchor, VirtualUpdateKind } from "@/lib/virtual/window";