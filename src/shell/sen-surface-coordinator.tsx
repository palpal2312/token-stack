"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  cloneElement,
  type ReactNode,
} from "react";
import {
  createMemorySenSurfaceStorage,
  createSenSurfaceStore,
  type SenSurface,
  type SenSurfaceState,
  type SenSurfaceStore,
} from "./sen-surface-store";
import {
  SenSurfaceContext,
  useSenSurface,
  type SenSurfaceValue,
} from "./sen-surface-context";
import { usePanelResize } from "./panel-resize-hook";
import {
  PANEL_MAX_SIZE,
  PANEL_MIN_SIZE,
  panelStateKey,
  type PanelLayoutStore,
} from "./panel-layout-store";

/**
 * SEN surface coordinator (Phase 19a U2).
 *
 * The authority that lets one active session present as a full page, a side
 * panel, or a floating composer — with EXCLUSIVITY: only ONE interactive composer
 * owns a session at a time, and the full-page surface suppresses the contextual
 * side-panel/floating copies (Phase 19a "Persistent shell and panel state
 * machine": "One `SenSurfaceCoordinator` chooses `page`, `side-panel`, or
 * `floating`; only one interactive composer owns a session at a time.").
 *
 * The surface switch and the session selection live in `sen-surface-store.ts`
 * (workspace-scoped, schema-versioned, secret-free, self-healing). Switching the
 * surface PRESERVES the canonical active session plus per-session draft and
 * scroll anchor (the store keys that continuity state by session, never clearing
 * it on a surface change), so composing on the page then moving to a floating
 * panel resumes the same session/draft/scroll.
 *
 * Inert by default: when the `sen_surface_coordinator` rollout flag is OFF this
 * component renders its `children` (the existing SenView/composer) unchanged —
 * the legacy behavior is byte-equivalent. The coordinator is only mounted by the
 * DesktopShell ViewHost under the flag.
 *
 * Clients read the surface authority through `useSenSurface()`; the surface
 * choice itself is accepted by the composer via a `surface` prop (see SenView).
 */

export interface SenSurfaceProviderProps {
  store: SenSurfaceStore;
  workspaceId: string;
  children: ReactNode;
}

/** React binding over the external surface store for one workspace. */
export function SenSurfaceProvider({ store, workspaceId, children }: SenSurfaceProviderProps) {
  const state: SenSurfaceState = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(workspaceId),
    // Deterministic default for SSR/hydration (the store's default state shape
    // is identical server- and client-side, so hydration matches without a
    // "Missing getServerSnapshot, will revert to client rendering" error).
    () => store.getSnapshot(workspaceId),
  );

  const value = useMemo<SenSurfaceValue>(
    () => ({
      surface: state.surface,
      composerOwner: store.composerOwner(workspaceId),
      activeSessionId: state.activeSessionId,
      setSurface: (surface) => store.setSurface(workspaceId, surface),
      setActiveSession: (sessionId) => store.setActiveSession(workspaceId, sessionId),
      saveDraft: (sessionId, draft) => store.saveDraft(workspaceId, sessionId, draft),
      draft: (sessionId) => store.draft(workspaceId, sessionId),
      saveScrollAnchor: (sessionId, anchor) => store.saveScrollAnchor(workspaceId, sessionId, anchor),
      scrollAnchor: (sessionId) => store.scrollAnchor(workspaceId, sessionId),
      setReturnFocus: (target) => store.setReturnFocus(workspaceId, target),
    }),
    [state, store, workspaceId],
  );

  return <SenSurfaceContext.Provider value={value}>{children}</SenSurfaceContext.Provider>;
}

const SURFACE_LABELS: { value: SenSurface; label: string }[] = [
  { value: "page", label: "Page" },
  { value: "side-panel", label: "Side panel" },
  { value: "floating", label: "Floating" },
];

const SURFACE_SWITCHER_CSS = `
.sen-surface-radio{background:transparent;color:var(--fg-dim);}
.sen-surface-radio[aria-checked="true"]{background:rgba(125,211,252,0.16);color:#7dd3fc;}
@media (forced-colors: active){
  .sen-surface-radio{color:CanvasText;}
  .sen-surface-radio[aria-checked="true"]{background:Highlight;color:HighlightText;}}
`;

/**
 * Standard ARIA radiogroup keyboard contract: Arrow keys move focus AND the
 * checked radio (checked follows focus, cycling at the ends). The checked radio
 * is the only one in the tab order (roving tabindex) so Tab/Space/Enter reach a
 * single switch in one keypress. When an arrow-key selection swaps the surface
 * frame (which remounts the toolbar), focus is re-asserted onto the active radio
 * so the switch never strands a keyboard user at the body. Pure keyboard-flow
 * correctness — click and Tab behavior for mouse users is unchanged.
 */
function moveSurfaceFocus(e: React.KeyboardEvent<HTMLButtonElement>, onSurface: (s: SenSurface) => void) {
  if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(e.key)) return;
  e.preventDefault();
  const group = e.currentTarget.parentElement;
  const radios = Array.from(group?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? []);
  const idx = radios.indexOf(e.currentTarget);
  if (idx === -1 || radios.length === 0) return;
  const forward = e.key === "ArrowRight" || e.key === "ArrowDown";
  const target = radios[forward ? (idx + 1) % radios.length : (idx - 1 + radios.length) % radios.length];
  const value = target.getAttribute("data-surface") as SenSurface | null;
  target.focus();
  if (value) onSurface(value); // checked follows focus
}

/** True only for the instant an arrow-key surface move triggers a frame swap; the
 * newly-mounted switcher reads it to re-assert focus (the old instance unmounts,
 * so its per-instance ref is lost across the remount). */
let surfaceArrowNavPending = false;

/** Segmented surface switch. The active surface owns the composer exclusively. */
export function SenSurfaceSwitcher() {
  const { surface, setSurface } = useSenSurface();
  const groupRef = useRef<HTMLDivElement | null>(null);
  if (surface === "none") return null;

  // An arrow-key selection swaps the frame, which remounts the toolbar (this
  // instance) and drops focus to the body. A brand-new switcher waiting on that
  // swap restores focus onto the now-active radio so the keyboard user is never
  // stranded. The freshly-mounted surface's composer auto-focuses just after the
  // swap, so a bounded retry (mirroring the shell FocusRestorer) re-asserts the
  // radiogroup focus until it wins. Guarded by the module flag so a normal mount
  // or mouse click never steals focus from wherever the user was.
  useLayoutEffect(() => {
    if (!surfaceArrowNavPending) return;
    surfaceArrowNavPending = false;
    const isInGroup = () => {
      const a = document.activeElement;
      return !!a && a instanceof HTMLElement && a.closest?.('[role="radiogroup"][aria-label="SEN surface"]');
    };
    const focusActive = () =>
      groupRef.current?.querySelector<HTMLButtonElement>('[role="radio"][aria-checked="true"]')?.focus?.();
    focusActive();
    const del = [60, 140, 280];
    let i = 0;
    const retry = (): void => {
      if (!isInGroup()) focusActive();
      i += 1;
      if (i === del.length) return;
      setTimeout(retry, del[i] - del[i - 1]);
    };
    const t = setTimeout(retry, del[0]);
    return () => clearTimeout(t);
  }, [surface]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(e.key)) surfaceArrowNavPending = true;
    moveSurfaceFocus(e, setSurface);
  };

  return (
    <div
      ref={groupRef}
      className="flex shrink-0 items-center gap-1 rounded-lg border p-0.5"
      style={{ borderColor: "var(--panel-border)" }}
      role="radiogroup"
      aria-label="SEN surface"
    >
      <style>{SURFACE_SWITCHER_CSS}</style>
      {SURFACE_LABELS.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={surface === value}
          tabIndex={surface === value ? 0 : -1}
          data-surface={value}
          onClick={() => setSurface(value)}
          onKeyDown={onKeyDown}
          className="rounded-md px-2.5 py-1 text-[11.5px] transition sen-surface-radio"
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Chrome above the chosen surface: surface switch + return-to-page affordance. */
function SurfaceToolbar() {
  const { setSurface } = useSenSurface();
  return (
    <div className="flex items-center justify-between gap-3 border-b px-3 py-2" style={{ borderColor: "var(--panel-border)" }}>
      <span className="text-[11px] uppercase tracking-[0.18em]" style={{ color: "var(--fg-dim)" }}>
        SEN surface
      </span>
      <div className="flex items-center gap-2">
        <SenSurfaceSwitcher />
        <button
          type="button"
          onClick={() => setSurface("page")}
          className="rounded-md px-2 py-1 text-[11px]"
          style={{ color: "var(--fg-dim)" }}
          title="Full-page SEN"
          aria-label="Back to full-page SEN"
        >
          Esc
        </button>
      </div>
    </div>
  );
}

/** Panel store key the SEN surface (re)-sizing writes to. */
export const SEN_SURFACE_PANEL_ID = "sen-surface";

/** `prefers-reduced-motion` read as a live boolean (SSR-safe). */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false,
  );
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

/**
 * Resizable contextual SEN frame (Phase 19a U2 wiring). Binds the pure
 * `usePanelResize` controller (rAF-batched pointer drag, pointer capture,
 * drag-end commit, container/DPI clamp, keyboard resize) + the visual state
 * machine to the shell's panel store. The frame width reads the store size
 * (already clamped by the controller). Reduced-motion drives the CSS transition
 * to zero delay. Purely an integration seam: no behavior change when the rollout
 * flag is OFF (this coordinator only mounts then) and no-op when `panelStore` is
 * absent (standalone/unit usage).
 */
function ResizableSurfaceFrame({
  type,
  children,
  panelStore,
  workspaceId,
}: {
  type: "side-panel" | "floating";
  children: ReactNode;
  panelStore: PanelLayoutStore;
  workspaceId: string;
}) {
  const outerRef = useRef<HTMLDivElement | null>(null);
  const edgeRef = useRef<HTMLDivElement | null>(null);
  const reduced = usePrefersReducedMotion();
  const key = panelStateKey(workspaceId, SEN_SURFACE_PANEL_ID);
  const size = useSyncExternalStore(
    (cb) => panelStore.subscribe(cb),
    () => panelStore.getSnapshot(key).size,
    () => panelStore.getSnapshot(key).size, // deterministic SSR/hydration default
  );
  const resize = usePanelResize({
    store: panelStore,
    workspaceId,
    panelId: SEN_SURFACE_PANEL_ID,
    edgeRef,
    containerRef: outerRef,
    prefersReducedMotion: reduced,
  });
  const width = `${Math.max(PANEL_MIN_SIZE, Math.round(size))}px`;
  const toolbar = (
    <>
      <SurfaceToolbar />
      <div
        ref={edgeRef}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize SEN panel"
        aria-valuenow={Math.round(size)}
        aria-valuemin={PANEL_MIN_SIZE}
        aria-valuemax={PANEL_MAX_SIZE}
        data-resize-edge="sen"
        tabIndex={0}
        onPointerDown={resize.onPointerDown}
        onPointerMove={resize.onPointerMove}
        onPointerUp={resize.onPointerUp}
        onKeyDown={resize.onKeyDown}
        className="shrink-0 cursor-ew-resize touch-none outline-none"
        style={{ width: 6, background: "transparent", ...(reduced ? { transition: "none" } : {}) }}
        title="Resize — drag, or Arrow/Shift+Arrow keys"
      />
    </>
  );
  if (type === "floating") {
    return (
      <div
        ref={outerRef}
        className="fixed bottom-4 right-4 z-50 flex max-h-[70vh] flex-col overflow-hidden rounded-2xl border shadow-2xl"
        style={{ borderColor: "var(--panel-border)", background: "var(--bg-mid, #17141f)", width, maxWidth: "calc(100vw - 2rem)", ...(reduced ? { transition: "none" } : { transition: "width 160ms ease" }), }}
        data-sen-surface-frame="floating"
        aria-label="SEN floating composer"
      >
        {toolbar}
        <div className="min-h-0 overflow-hidden">{children}</div>
      </div>
    );
  }
  return (
    <div ref={outerRef} className="absolute inset-0 flex justify-end">
      <aside
        className="flex h-full min-h-0 flex-col border-l"
        style={{ borderColor: "var(--panel-border)", background: "var(--bg-mid, #17141f)", width, minWidth: 0, maxWidth: "100%", ...(reduced ? { transition: "none" } : { transition: "width 160ms ease" }), }}
        data-sen-surface-frame="side-panel"
        aria-label="SEN side panel"
      >
        <SurfaceToolbar />
        <div ref={edgeRef} role="separator" aria-orientation="vertical" aria-label="Resize SEN panel"
          aria-valuenow={Math.round(size)} aria-valuemin={PANEL_MIN_SIZE} aria-valuemax={PANEL_MAX_SIZE}
          data-resize-edge="sen" tabIndex={0}
          onPointerDown={resize.onPointerDown} onPointerMove={resize.onPointerMove} onPointerUp={resize.onPointerUp}
          onKeyDown={resize.onKeyDown}
          className="shrink-0 cursor-ew-resize self-stretch touch-none outline-none"
          style={{ width: 6, height: 0, flexGrow: 0, background: "transparent", ...(reduced ? { transition: "none" } : {}) }}
          title="Resize — drag, or Arrow/Shift+Arrow keys"
        />
        <div className="min-h-0 flex-1">{children}</div>
      </aside>
    </div>
  );
}

/**
 * Renders the composer (children) inside the chosen surface frame. Only ONE
 * frame is ever mounted, so at most one composer owns the session. Passing the
 * selected surface through to a single-element composer child lets the composer
 * accept the surface choice without a global import (inert default otherwise).
 */
function SurfaceFrame({
  surface,
  children,
  panelStore,
  workspaceId,
}: {
  surface: SenSurface;
  children: ReactNode;
  panelStore: PanelLayoutStore | null;
  workspaceId: string;
}) {
  const content = useMemo(() => {
    if (typeof children === "object" && children !== null && "type" in children) {
      const el = children as React.ReactElement<{ surface?: SenSurface }>;
      try {
        return cloneElement(el, { surface });
      } catch {
        return children;
      }
    }
    return children;
  }, [children, surface]);

  if (surface === "side-panel" || surface === "floating") {
    // Integrate with the shell panel store when present; otherwise keep the
    // static contextual frame (standalone/unit use).
    if (panelStore) {
      return (
        <ResizableSurfaceFrame type={surface} panelStore={panelStore} workspaceId={workspaceId}>
          {content}
        </ResizableSurfaceFrame>
      );
    }
    return surface === "floating" ? (
      <div className="fixed bottom-4 right-4 z-50 flex max-h-[70vh] w-[min(560px,92vw)] flex-col overflow-hidden rounded-2xl border shadow-2xl"
        style={{ borderColor: "var(--panel-border)", background: "var(--bg-mid, #17141f)" }}
        aria-label="SEN floating composer"
      >
        <SurfaceToolbar />
        <div className="min-h-0 overflow-hidden">{content}</div>
      </div>
    ) : (
      <div className="absolute inset-0 flex justify-end">
        <aside
          className="flex h-full min-h-0 w-[min(720px,92vw)] flex-col border-l"
          style={{ borderColor: "var(--panel-border)", background: "var(--bg-mid, #17141f)" }}
          aria-label="SEN side panel"
        >
          <SurfaceToolbar />
          <div className="min-h-0 flex-1">{content}</div>
        </aside>
      </div>
    );
  }
  // page (default)
  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <SurfaceToolbar />
      <div className="min-h-0 flex-1">{content}</div>
    </div>
  );
}

export interface SenSurfaceCoordinatorProps {
  workspaceId?: string;
  store?: SenSurfaceStore;
  /**
   * The shell's panel-layout store, used by the resizable contextual SEN frames
   * (width, keyboard/pointer resize, container clamp, reduced-motion). Threaded
   * down to avoid an import cycle with desktop-shell. Omit for standalone/unit
   * use — the frames then keep their static widths (no resize edge).
   */
  panelStore?: PanelLayoutStore | null;
  /**
   * Resolved server-side from the rollout flag (a client cannot read env). When
   * false/undefined the coordinator is INERT — it renders children unchanged, so
   * the legacy SenView/composer behavior is byte-equivalent.
   */
  enabled?: boolean;
  children: ReactNode;
}

/**
 * Root coordinator seam. INERT when the rollout flag is OFF (passed in as
 * `enabled`) — renders children unchanged so the legacy SenView/composer
 * behavior is byte-equivalent. When ON, wraps children with the surface
 * authority provider + the selected frame.
 */
export default function SenSurfaceCoordinator({
  workspaceId = "local",
  store: storeProp,
  panelStore = null,
  enabled = false,
  children,
}: SenSurfaceCoordinatorProps) {
  const storeRef = useRef<SenSurfaceStore | null>(storeProp ?? null);
  if (storeRef.current === null) {
    storeRef.current = createSenSurfaceStore({ storage: createMemorySenSurfaceStorage() });
  }
  const store = storeRef.current;

  // Inert: the flag is OFF → preserve the existing composer exactly.
  if (!enabled) return <>{children}</>;

  return (
    <SenSurfaceProvider store={store} workspaceId={workspaceId}>
      <SurfaceFrameHost panelStore={panelStore} workspaceId={workspaceId}>
        {children}
      </SurfaceFrameHost>
    </SenSurfaceProvider>
  );
}

/** Reads `surface` from the provider and renders the matching frame. */
function SurfaceFrameHost({
  children,
  panelStore,
  workspaceId,
}: {
  children: ReactNode;
  panelStore: PanelLayoutStore | null;
  workspaceId: string;
}) {
  const { surface } = useSenSurface();
  return (
    <SurfaceFrame surface={surface} panelStore={panelStore} workspaceId={workspaceId}>
      {children}
    </SurfaceFrame>
  );
}