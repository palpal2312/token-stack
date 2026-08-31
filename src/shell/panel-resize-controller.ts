/**
 * Panel resize controller (Phase 19a U2).
 *
 * Framework-agnostic interaction controller for panel drag-resizing. It owns the
 * PERFORMANCE + GUARD contracts the phase file demands (Phase 19a "Panel motion"
 * + "Resize"):
 *
 *   - rAF batching: pointer moves accumulate into ONE pending size; at most one
 *     DOM write is flushed per animation frame, never one write per mousemove.
 *   - Pointer capture: the controller tracks the originating pointer id and the
 *     integration calls `setPointerCapture` so moves outside the element are
 *     still routed to the drag (no pointer leak — the drag always resolves).
 *   - Size commit at drag end only: `updateDrag` writes DOM live but NEVER
 *     triggers the persisted commit; `endDrag` (or a keyboard step) is the sole
 *     commit path (the store already persists size on commit — kept here too).
 *   - Container/DPI clamp: every proposed size is clamped to the current
 *     container/breakpoint via `clampPanelSizeToContainer`.
 *   - ResizeObserver loop guard: a container-resize notification is ignored
 *     while the controller is inside its own DOM write (`writing`) or mid-drag /
 *     with a batched write pending, so an observer echo can never re-enter and
 *     loop. It also only schedules a write when the re-clamp actually changes
 *     the applied size (no stale/identical writes).
 *   - Keyboard resizing: discrete arrow/shift-arrow steps, clamped, applied
 *     immediately and committed (a keyboard edge resize is one intentional step).
 *
 * Pure module: no React, no Next.js, no DOM — the scheduler and the size/commit
 * callbacks are injected so the batching/guard/clamp logic is unit-testable under
 * node:test (mirroring `view-session-coordinator.ts` injectable seams).
 */

import { clampPanelSizeToContainer, PANEL_MIN_SIZE, PANEL_MAX_SIZE } from "./panel-layout-store";

/** Effective bounds a resize is clamped against (min, max, live container size). */
export interface ResizeBounds {
  min: number;
  max: number;
  /** Available width-or-height in px; finite & > 0 to take effect. */
  containerSize: number;
}

/** A rAF-like scheduler: `schedule(fn)` runs `fn` at most once per queued frame. */
export type ResizeScheduler = (fn: () => void) => void;

/** Calling conventions for the integration (DOM write + persisted commit). */
export interface PanelResizeControllerOptions {
  /** DOM write of the clamped size (batched to once per frame). */
  onSize(size: number): void;
  /** Persisted commit of a size (drag end / keyboard step only). */
  onCommit(size: number): void;
  /** Live bounds provider (reads the current container/breakpoint). */
  bounds(): ResizeBounds;
  /** Scheduler — real rAF in the DOM, a queue in tests. */
  schedule: ResizeScheduler;
}

export interface PanelResizeController {
  /** Begin a pointer drag on this panel, capturing `pointerId`. */
  beginDrag(startSize: number, pointerId: number): void;
  /** A pointer move: computes the proposed clamped size and schedules one flush. */
  updateDrag(clientPos: number, startPos: number, startSize: number): void;
  /** End the drag: flush any pending write, commit the size, release the pointer. */
  endDrag(): void;
  /** Discrete keyboard resize step (arrows/shift-arrows), clamped + committed. */
  keyboardStep(startSize: number, delta: number, shift: boolean): number;
  /**
   * ResizeObserver notification. Returns true when it scheduled a write. It is
   * IGNORED during the controller's own write and while a drag / batched write
   * is pending (loop guard), and only writes when the re-clamp changes the size.
   */
  onContainerResize(): boolean;
  /** Unflushed proposed size (null when none). */
  proposedSize(): number | null;
  /** The size last written to the DOM (the applied size). */
  appliedSize(): number;
  isDragging(): boolean;
  pointerId(): number | null;
  /** True while inside an `onSize` call (own write guard). */
  isWriting(): boolean;
}

/** Discrete keyboard increments (px) — fine with arrow, coarse with Shift+arrow. */
export const KEYBOARD_STEP_PX = 40;
export const KEYBOARD_SHIFT_STEP_PX = 160;

export function createPanelResizeController(
  options: PanelResizeControllerOptions,
): PanelResizeController {
  const { onSize, onCommit, bounds, schedule } = options;

  let dragging = false;
  let capturedPointer: number | null = null;
  let pending: number | null = null;
  let scheduled = false;
  let writing = false;
  let applied: number | null = null;

  const clamp = (size: number): number => {
    const b = bounds();
    return clampPanelSizeToContainer(size, b.containerSize, b.min, b.max);
  };
  // `schedule` is normalized to a plain callable in `createPanelResizeController`
  // (a queue in tests, requestAnimationFrame in the DOM).

  const scheduleFlush = () => {
    if (scheduled) return;
    scheduled = true;
    schedule(() => {
      scheduled = false;
      if (pending === null) return;
      const v = pending;
      pending = null;
      writing = true;
      try {
        onSize(v);
        applied = v;
      } finally {
        writing = false;
      }
    });
  };

  return {
    beginDrag(startSize, pointerId) {
      dragging = true;
      capturedPointer = pointerId;
      pending = clamp(startSize);
      applied = clamp(startSize);
      // No DOM write on begin — the panel is already at its visible size; the
      // write occurs on the first pointer move. pending is set so a zero-move
      // drag still commits the clamped start at endDrag.
    },
    updateDrag(clientPos, startPos, startSize) {
      if (!dragging) return;
      const proposed = clamp(startSize + (clientPos - startPos));
      const changed = proposed !== pending;
      pending = proposed;
      // At most ONE schedule regardless of how many pointer moves land this frame.
      if (changed && !scheduled) scheduleFlush();
    },
    endDrag() {
      if (!dragging) return;
      // Flush any un-written pending (guarded: only fires when pending is set).
      scheduleFlush();
      if (scheduled) {
        // A real rAF may not have fired yet — force the final size synchronously
        // so the commit reflects what the user left the edge at.
        scheduled = false;
        if (pending !== null) {
          const v = pending;
          pending = null;
          writing = true;
          try {
            onSize(v);
            applied = v;
          } finally {
            writing = false;
          }
        }
        // Cancel the stale scheduled flush (if any) by leaving scheduled=false —
        // the scheduler's later callback sees pending===null and does nothing.
      }
      onCommit(applied ?? clamp(0));
      dragging = false;
      capturedPointer = null;
    },
    keyboardStep(startSize, delta, shift) {
      const step = shift ? KEYBOARD_SHIFT_STEP_PX : KEYBOARD_STEP_PX;
      const proposed = clamp(startSize + Math.sign(delta || 1) * step);
      writing = true;
      try {
        onSize(proposed);
        applied = proposed;
      } finally {
        writing = false;
      }
      onCommit(proposed);
      return proposed;
    },
    onContainerResize() {
      // Loop guard: never re-enter while our own write is on the stack, nor while
      // a drag is active / a batched write is pending.
      if (writing) return false;
      if (scheduled || dragging) return false;
      const base = applied ?? clamp(0);
      const reclamped = clamp(base);
      if (reclamped === base) return false;
      pending = reclamped;
      scheduleFlush();
      return true;
    },
    proposedSize() {
      return pending;
    },
    appliedSize() {
      return applied ?? clamp(0);
    },
    isDragging() {
      return dragging;
    },
    pointerId() {
      return capturedPointer;
    },
    isWriting() {
      return writing;
    },
  };
}

/** Bounds helper for a fixed min/max/container triple. */
export function fixedBounds(min: number, max: number, containerSize: number): ResizeBounds {
  // Guard: never derive bounds from NaN/undefined store constants.
  const m = Number.isFinite(min) ? min : PANEL_MIN_SIZE;
  const M = Number.isFinite(max) ? max : PANEL_MAX_SIZE;
  return { min: m, max: M, containerSize };
}