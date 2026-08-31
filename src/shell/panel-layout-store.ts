/**
 * Panel layout store (Phase 19a U1).
 *
 * A disposable, schema-versioned, per-workspace external store for EPHEMERAL
 * panel/panel behaviors ONLY: which panel is present, its visual mode, logical
 * open state, dock, and size. It intentionally mirrors NO server/query state —
 * canonical session, realtime, and runtime authority live elsewhere (Phase 8b,
 * the query cache). It powers `useSyncExternalStore`-derived React hooks (a
 * small NEWS OS external store; zustand is intentionally not installed).
 *
 * Persistence rules (Phase 19a "Persistent shell and panel state machine"):
 *   - `setSize` during a drag is a memory-only write; `commitSize` (drag end)
 *     or `checkpoint` persists it.
 *   - Restored sizes are clamped to the current min/max at hydrate time.
 *   - Logical open state / mode persist on open/close/toggle.
 *
 * This module is pure (no React, no Next.js, no DOM) so it is unit-testable
 * under node:test, mirroring `desktop-module-registry.ts`.
 */

export const PANEL_SCHEMA_VERSION = 1;

export type PanelDock = "left" | "right" | "bottom";
export type PanelMode = string;

export interface PanelLayoutState {
  workspaceId: string;
  panelId: string;
  /** Visual/content mode; "closed" is the empty default. */
  mode: PanelMode;
  /** Logical (intended) visibility, independent of visual transition state. */
  logicalOpen: boolean;
  /** Width-or-height of the panel in px (dock-appropriate). */
  size: number;
  dock: PanelDock;
  schemaVersion: number;
}

export const PANEL_MIN_SIZE = 240;
export const PANEL_MAX_SIZE = 720;
export const PANEL_DEFAULT_SIZE = 380;

/** Clamp a raw size to the panel bounds, tolerating NaN/Infinity/undefined. */
export function clampPanelSize(
  size: unknown,
  min = PANEL_MIN_SIZE,
  max = PANEL_MAX_SIZE,
): number {
  if (typeof size !== "number" || !Number.isFinite(size)) return min;
  return Math.min(max, Math.max(min, Math.round(size)));
}

/**
 * Container-aware / DPI-aware clamp (Phase 19a U2). A restored or dragged size is
 * clamped not just to the abstract [min, max] but also to the CURRENT container /
 * breakpoint: `containerSize` is the available width-or-height in CSS px. A
 * stored size that exceeds the on-screen container is clamped down on restore so
 * a panel can never paint wider/taller than its host. NaN/Infinity/absent
 * containerSize falls back to the raw max.
 */
export function clampPanelSizeToContainer(
  size: unknown,
  containerSize: number,
  min = PANEL_MIN_SIZE,
  max = PANEL_MAX_SIZE,
): number {
  const ceiling =
    Number.isFinite(containerSize) && containerSize > 0 ? Math.floor(containerSize) : max;
  const effectiveMax = Math.max(min, Math.min(max, ceiling));
  return clampPanelSize(size, min, effectiveMax);
}

// --- Panel visual state machine (Phase 19a U2) -------------------------------
//
// Logical visibility (`logicalOpen`) is the SOURCE of truth for whether a panel
// should be present. The visual phase (`PanelPhase`) separates presentation
// transition state from that logical intent so resize events never fight the
// toggle target. Cycle: closed -> opening -> open -> resizing -> open -> closing
// -> closed. Interruption always resolves deterministically to ONE target — the
// most recent intent wins and the machine never blocks on a half-resize or a
// stale transition (Phase 19a "Panel motion": logical open state is separated
// from visual transition state; resize does not fight the toggle target).
// Reduced-motion uses zero transition delay (opening/closing settle instantly).

export type PanelPhase = "closed" | "opening" | "open" | "resizing" | "closing";

/** The discrete intents a caller issues to the visual machine. */
export type PanelIntent = "open" | "close" | "resize" | "settle";

/**
 * Deterministic phase transition. `settle` advances an in-flight animation one
 * beat (opening→open, closing→closed); `open`/`close` override any in-flight
 * transition toward the requested logical target; `resize` only takes hold while
 * the panel is already open (a resize while closing/closed is a no-op — no stuck
 * "resizing" during a close). When `reducedMotion`, transition phases are
 * skipped entirely: open→open, close→closed (zero animation delay).
 */
export function nextPanelPhase(
  current: PanelPhase,
  intent: PanelIntent,
  reducedMotion = false,
): PanelPhase {
  if (reducedMotion) {
    switch (intent) {
      case "open":
        return "open";
      case "close":
        return "closed";
      case "resize":
        return current === "resizing" || current === "open" ? "resizing" : current;
      case "settle":
        return current; // nothing to animate — already at the terminal target
    }
  }
  switch (intent) {
    case "settle":
      return current === "opening" ? "open" : current === "closing" ? "closed" : current;
    case "open":
      return current === "open" || current === "resizing" ? "open" : "opening";
    case "close":
      return current === "closed" ? "closed" : "closing";
    case "resize":
      return current === "open" || current === "resizing" ? "resizing" : current;
  }
}

/** Default (safe) state for a workspace/panel pair. */
export function defaultPanelState(workspaceId = "local", panelId = "contextual"): PanelLayoutState {
  return {
    workspaceId,
    panelId,
    mode: "closed",
    logicalOpen: false,
    size: PANEL_DEFAULT_SIZE,
    dock: "left",
    schemaVersion: PANEL_SCHEMA_VERSION,
  };
}

/**
 * Version-tolerant hydration. Unknown/future schema versions degrade forward to
 * the public v1 shape: sizes clamp, unknown cruft is dropped, and missing
 * fields fall back to defaults — corrupt stored state self-heals.
 */
export function migratePanelState(
  raw: unknown,
  fallbackWorkspace: string,
  fallbackPanel: string,
  min = PANEL_MIN_SIZE,
  max = PANEL_MAX_SIZE,
): PanelLayoutState {
  if (raw === null || typeof raw !== "object") return defaultPanelState(fallbackWorkspace, fallbackPanel);
  const o = raw as Record<string, unknown>;
  return {
    workspaceId: typeof o.workspaceId === "string" ? o.workspaceId : fallbackWorkspace,
    panelId: typeof o.panelId === "string" ? o.panelId : fallbackPanel,
    mode: typeof o.mode === "string" ? o.mode : "closed",
    logicalOpen: o.logicalOpen === true,
    size: clampPanelSize(o.size, min, max),
    dock: o.dock === "right" || o.dock === "bottom" ? o.dock : "left",
    schemaVersion: PANEL_SCHEMA_VERSION,
  };
}

/** Deterministic key for `workspaceId::panelId`. */
export function panelStateKey(workspaceId: string, panelId: string): string {
  return `${workspaceId}::${panelId}`;
}

/** Split a persisted key back into workspaceId + panelId. */
export function splitPanelStateKey(key: string): { workspaceId: string; panelId: string } {
  const i = key.indexOf("::");
  return i === -1
    ? { workspaceId: key, panelId: "contextual" }
    : { workspaceId: key.slice(0, i), panelId: key.slice(i + 2) };
}

/** Storage seam so the store stays pure; injectable for tests/adapters. */
export interface PanelLayoutStorage {
  readAll(): Record<string, PanelLayoutState>;
  writeAll(entries: Record<string, PanelLayoutState>): void;
}

/** In-memory storage (default and test double). */
export function createMemoryPanelStorage(): PanelLayoutStorage {
  let entries: Record<string, PanelLayoutState> = {};
  return {
    readAll: () => entries,
    writeAll: (next) => {
      entries = next;
    },
  };
}

/**
 * Browser-local storage adapter. Each panel is serialized under one keyed
 * record; writes are guarded so a full/private-mode quota error never throws.
 * Successful reads/persists drive no product authority — panel view state only.
 */
export function createLocalStoragePanelStorage(
  prefix = "newsos.panel-layout",
): PanelLayoutStorage {
  const read = (): Record<string, PanelLayoutState> => {
    try {
      const raw = window.localStorage.getItem(prefix);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as unknown;
      if (parsed === null || typeof parsed !== "object") return {};
      return parsed as Record<string, PanelLayoutState>;
    } catch {
      return {};
    }
  };
  return {
    readAll: read,
    writeAll(entries) {
      try {
        window.localStorage.setItem(prefix, JSON.stringify(entries));
      } catch {
        /* quota / privacy — panel prefs are disposable */
      }
    },
  };
}

export interface PanelLayoutStore {
  /** Subscribe to any state change; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** Stable reference to the current state at `key`; constant between patches. */
  getSnapshot(key: string): PanelLayoutState;
  setOpen(workspaceId: string, panelId: string, logicalOpen: boolean): PanelLayoutState;
  /** Nil-mode + closed; persists. */
  close(workspaceId: string, panelId: string): PanelLayoutState;
  toggle(workspaceId: string, panelId: string): PanelLayoutState;
  setMode(workspaceId: string, panelId: string, mode: PanelMode): PanelLayoutState;
  /** Ephemeral size write during a drag — NOT persisted. */
  setSize(workspaceId: string, panelId: string, size: number): PanelLayoutState;
  /** Persist current size (drag end / checkpoint). */
  commitSize(workspaceId: string, panelId: string): PanelLayoutState;
  /**
   * Visual phase for a panel (Phase 19a U2). Ephemeral — never persisted, resets
   * to `closed` for an unknown panel.
   */
  getPanelPhase(workspaceId: string, panelId: string): PanelPhase;
  /**
   * Issue a discrete intent to the panel's visual state machine
   * (`nextPanelPhase`). Emits (so the UI re-reads the phase) and returns it.
   * Not persisted — logical visibility is stored separately (`logicalOpen`).
   */
  applyPanelIntent(workspaceId: string, panelId: string, intent: PanelIntent, reducedMotion?: boolean): PanelPhase;
  /** Persist the current layout snapshot. */
  checkpoint(workspaceId: string, panelId: string): void;
  /** Drop a workspace's panels (logout / account switch, privacy). */
  clearWorkspace(workspaceId: string): void;
  /** Number of tracked panels (test/diagnostic). */
  stateCount(): number;
  /** Current persisted record (test/diagnostic). */
  persisted(): Record<string, PanelLayoutState>;
}

export interface PanelLayoutStoreOptions {
  storage?: PanelLayoutStorage;
  minSize?: number;
  maxSize?: number;
}

export function createPanelLayoutStore(options: PanelLayoutStoreOptions = {}): PanelLayoutStore {
  const storage = options.storage ?? createMemoryPanelStorage();
  const minSize = options.minSize ?? PANEL_MIN_SIZE;
  const maxSize = options.maxSize ?? PANEL_MAX_SIZE;

  // Hydrate once: migrate + clamp persisted entries into live memory.
  const current = new Map<string, PanelLayoutState>();
  for (const [key, value] of Object.entries(storage.readAll())) {
    const { workspaceId, panelId } = splitPanelStateKey(key);
    current.set(key, migratePanelState(value, workspaceId, panelId, minSize, maxSize));
  }

  const listeners = new Set<() => void>();
  const emit = () => {
    for (const l of listeners) l();
  };

  // Ephemeral visual phases (not persisted; resets per panel key on demand).
  const phases = new Map<string, PanelPhase>();

  const ensure = (key: string): PanelLayoutState => {
    let state = current.get(key);
    if (!state) {
      const { workspaceId, panelId } = splitPanelStateKey(key);
      state = {
        ...defaultPanelState(workspaceId, panelId),
        size: clampPanelSize(PANEL_DEFAULT_SIZE, minSize, maxSize),
      };
      current.set(key, state);
    }
    return state;
  };

  const patch = (key: string, update: Partial<PanelLayoutState>): PanelLayoutState => {
    const base = ensure(key);
    const next: PanelLayoutState = { ...base, ...update };
    if (update.size !== undefined) next.size = clampPanelSize(update.size, minSize, maxSize);
    current.set(key, next);
    emit();
    return next;
  };

  const persistAll = () => {
    const out: Record<string, PanelLayoutState> = {};
    for (const [key, value] of current) out[key] = { ...value };
    storage.writeAll(out);
  };

  const setOpenLocal = (workspaceId: string, panelId: string, logicalOpen: boolean): PanelLayoutState => {
    const next = patch(panelStateKey(workspaceId, panelId), { logicalOpen });
    persistAll();
    return next;
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: ensure,
    setOpen: setOpenLocal,
    close(workspaceId, panelId) {
      const next = patch(panelStateKey(workspaceId, panelId), { logicalOpen: false, mode: "closed" });
      persistAll();
      return next;
    },
    toggle(workspaceId, panelId) {
      const next = patch(panelStateKey(workspaceId, panelId), {
        logicalOpen: !ensure(panelStateKey(workspaceId, panelId)).logicalOpen,
      });
      persistAll();
      return next;
    },
    setMode(workspaceId, panelId, mode) {
      const next = patch(panelStateKey(workspaceId, panelId), { mode });
      persistAll();
      return next;
    },
    setSize(workspaceId, panelId, size) {
      return patch(panelStateKey(workspaceId, panelId), { size });
    },
    commitSize(workspaceId, panelId) {
      persistAll();
      return ensure(panelStateKey(workspaceId, panelId));
    },
    getPanelPhase(workspaceId, panelId) {
      return phases.get(panelStateKey(workspaceId, panelId)) ?? "closed";
    },
    applyPanelIntent(workspaceId, panelId, intent, reducedMotion = false) {
      const key = panelStateKey(workspaceId, panelId);
      const prev = phases.get(key) ?? "closed";
      const nextPhase = nextPanelPhase(prev, intent, reducedMotion);
      // A closed/default phase only advances when a real transition occurs.
      if (nextPhase !== prev) {
        phases.set(key, nextPhase);
        // Keep logical visibility in step with the machine's settled target so the
        // toggle target and the drive never fight.
        if (intent === "open") setOpenLocal(workspaceId, panelId, true);
        else if (intent === "close") setOpenLocal(workspaceId, panelId, false);
        emit();
      }
      return nextPhase;
    },
    checkpoint(workspaceId, panelId) {
      persistAll();
    },
    clearWorkspace(workspaceId) {
      for (const key of [...current.keys()]) {
        if (splitPanelStateKey(key).workspaceId === workspaceId) current.delete(key);
      }
      emit();
      persistAll();
    },
    stateCount() {
      return current.size;
    },
    persisted() {
      const out: Record<string, PanelLayoutState> = {};
      for (const [key, value] of current) out[key] = { ...value };
      return out;
    },
  };
}