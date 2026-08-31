"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  createPanelResizeController,
  type PanelResizeController,
  type ResizeBounds,
  type ResizeScheduler,
} from "./panel-resize-controller";
import { PANEL_MIN_SIZE, PANEL_MAX_SIZE, type PanelLayoutStore } from "./panel-layout-store";

/**
 * Panel resize DOM wiring (Phase 19a U2).
 *
 * Attaches the pure `PanelResizeController` to the DOM for one panel:
 *
 *   - Pointer capture: `onPointerDown` captures the pointer on the resize edge so
 *     pointer move/up keep flowing to the drag even outside the element — no
 *     pointer leak; the drag always resolves.
 *   - rAF-batched pointer updates: `pointermove` feeds the controller, which
 *     schedules ONE DOM write per frame (the controller's onSize writes to the
 *     store — a memory-only write via setSize).
 *   - Size commit at drag end only: `pointerup` calls `endDrag` (which writes any
 *     last frame + persists via commitSize). Resize resolves the visual phase.
 *   - Keyboard resizing: Arrow keys / Shift+Arrow keys on the focusable edge step
 *     the size (clamped to the live container), applied + committed immediately,
 *     and are prevented from scrolling.
 *   - ResizeObserver loop guard: the controller ignores observer echoes while it
 *     is inside its own write or mid-drag; an idle re-clamp to a shrunk container
 *     is applied + persisted once.
 *   - Reduced-motion: read from `prefers-reduced-motion`, so the open/close
 *     transition has zero delay (no opening/closing phase).
 *
 * The store, workspaceId and panelId are passed in (not read from context) so
 * this hook stays dependency-light and never creates an import cycle with
 * `desktop-shell.tsx`. SSR-safe: nothing touches the window during setup.
 */

export interface UsePanelResizeOptions {
  store: PanelLayoutStore;
  workspaceId: string;
  panelId: string;
  /** Ref to the focusable resize edge (gets pointer capture + keyboard). */
  edgeRef: React.RefObject<HTMLElement | null>;
  /** Ref to the panel's host container (drives the DPI/container clamp + observer). */
  containerRef?: React.RefObject<HTMLElement | null>;
  prefersReducedMotion?: boolean;
}

export interface PanelResizeApi {
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
}

const RAFFallback = (fn: () => void): void => {
  if (typeof window !== "undefined" && typeof requestAnimationFrame === "function") {
    requestAnimationFrame(fn);
  } else {
    fn();
  }
};

export function usePanelResize(options: UsePanelResizeOptions): PanelResizeApi {
  const { store, workspaceId, panelId, edgeRef, containerRef } = options;
  const prefersReducedMotion = options.prefersReducedMotion ?? false;

  // Drag anchor captured at pointerdown.
  const dragRef = useRef<{ startPos: number; startSize: number; pointerId: number } | null>(null);

  // rAF scheduler (real, with a synchronous fallback).
  const schedulerRef = useRef<ResizeScheduler>(RAFFallback);
  const schedule = useCallback((fn: () => void) => schedulerRef.current(fn), []);

  const bounds = useCallback((): ResizeBounds => {
    const cont = containerRef?.current;
    const containerSize =
      cont && cont.clientWidth > 0
        ? cont.clientWidth
        : cont && cont.clientHeight > 0
          ? cont.clientHeight
          : Number.POSITIVE_INFINITY;
    return { min: PANEL_MIN_SIZE, max: PANEL_MAX_SIZE, containerSize };
  }, [containerRef]);

  const controllerRef = useRef<PanelResizeController | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = createPanelResizeController({
      onSize: (size) => store.setSize(workspaceId, panelId, size),
      onCommit: (size) => {
        store.setSize(workspaceId, panelId, size);
        store.commitSize(workspaceId, panelId);
      },
      bounds,
      schedule,
    });
  }
  const controller = controllerRef.current;

  // Reduced-motion: resolve phases with zero transition delay.
  const reducedMotion = useMemo(
    () =>
      prefersReducedMotion ||
      (typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches),
    [prefersReducedMotion],
  );

  // Keep the controller's bounds live when the container is observed.
  useEffect(() => {
    const cont = containerRef?.current;
    if (!cont || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const changed = controller.onContainerResize();
      if (changed) store.commitSize(workspaceId, panelId);
    });
    ro.observe(cont);
    return () => ro.disconnect();
  }, [controller, containerRef, store, workspaceId, panelId]);

  const currentSize = useCallback(
    () => store.getSnapshot(`${workspaceId}::${panelId}`).size,
    [store, workspaceId, panelId],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const node = edgeRef.current;
      if (!node) return;
      try {
        node.setPointerCapture(e.pointerId);
      } catch {
        /* pointer capture is best-effort on some test hosts */
      }
      dragRef.current = { startPos: e.clientX, startSize: currentSize(), pointerId: e.pointerId };
      controller.beginDrag(currentSize(), e.pointerId);
      store.applyPanelIntent(workspaceId, panelId, "resize", reducedMotion);
      e.preventDefault();
      e.stopPropagation();
    },
    [edgeRef, controller, store, workspaceId, panelId, currentSize, reducedMotion],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      controller.updateDrag(e.clientX, drag.startPos, drag.startSize);
    },
    [controller],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (!dragRef.current) return;
      dragRef.current = null;
      controller.endDrag(); // commits size + resolves the drag (pointer released)
      store.applyPanelIntent(workspaceId, panelId, "open", reducedMotion);
      const node = edgeRef.current;
      if (node) {
        try {
          node.releasePointerCapture(e.pointerId);
        } catch {
          /* best-effort */
        }
      }
    },
    [controller, store, workspaceId, panelId, edgeRef, reducedMotion],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      let delta: number;
      if (e.key === "ArrowUp" || e.key === "ArrowDown") delta = e.key === "ArrowUp" ? -1 : 1;
      else if (e.key === "ArrowLeft" || e.key === "ArrowRight") delta = e.key === "ArrowLeft" ? -1 : 1;
      else return;
      e.preventDefault();
      controller.keyboardStep(currentSize(), delta, e.shiftKey);
      store.applyPanelIntent(workspaceId, panelId, "open", reducedMotion);
    },
    [controller, store, workspaceId, panelId, currentSize, reducedMotion],
  );

  return { onPointerDown, onPointerMove, onPointerUp, onKeyDown };
}