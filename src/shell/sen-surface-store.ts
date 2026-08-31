/**
 * SEN surface store (Phase 19a U2).
 *
 * Disposable, schema-versioned, per-workspace external store for the SEN surface
 * authority ONLY: which presentation surface is active (`page` | `side-panel` |
 * `floating`), the canonical session selection, the single composer owner, and
 * focus handoff. It intentionally mirrors NO server/query/transcript state —
 * canonical session/attempt/realtime authority lives in Phase 8b + the query
 * cache (Phase 19a authority split). Backs `useSyncExternalStore`-derived React
 * hooks like `panel-layout-store.ts`.
 *
 * Exclusivity contract (Phase 19a "Persistent shell and panel state machine"):
 *   - ONE interactive composer owns the active session at a time. The full-page
 *     surface suppresses the contextual side-panel/floating copies.
 *   - `composerOwner` is DERIVED from `surface` (single source of truth), so it
 *     can never disagree with the chosen surface.
 *   - Switching surface PRESERVES the canonical `activeSessionId` plus the
 *     per-session `draft` and `scrollAnchor` continuity state keyed by session —
 *     nothing is cleared on a surface switch.
 *
 * Persistence / safety: workspace namespaced, schema-versioned, SECRET-FREE
 * (hydration strips unknown keys so no secret round-trips), and corrupt /
 * unknown-version / oversized persisted state SELF-HEALS to the safe default
 * (page, no session, no drafts). This module never throws.
 *
 * Pure module (no React, no Next.js, no DOM) — unit-testable under node:test.
 */

export const SEN_SURFACE_SCHEMA_VERSION = 1 as const;

/** Ephemeral presentation surfaces a session can compose on. */
export type SenSurface = "page" | "side-panel" | "floating" | "none";

/** Which surface holds the interactive composer for the active session. */
export type SenComposerOwner = "page" | "side-panel" | "floating" | null;

export interface SenSurfaceState {
  workspaceId: string;
  surface: SenSurface;
  activeSessionId: string | null;
  /** Focus handoff target the surface hands keyboard focus back to. */
  returnFocusTarget: string | null;
  /** Per-session draft text, keyed by session id; survives surface switches. */
  drafts: Record<string, string>;
  /** Per-session scroll anchor, keyed by session id; survives surface switches. */
  scrollAnchors: Record<string, number>;
  schemaVersion: typeof SEN_SURFACE_SCHEMA_VERSION;
}

/** Surface choices that hold an interactive composer (contextual suppress set). */
const COMPOSER_SURFACES: readonly SenSurface[] = ["page", "side-panel", "floating"];

/** The surface that owns the composer (derived, single source of truth). */
export function composerOwnerFor(surface: SenSurface): SenComposerOwner {
  if (surface === "none") return null;
  return COMPOSER_SURFACES.includes(surface) ? (surface as SenComposerOwner) : null;
}

/** Default (safe) state — page surface, no session, no drafts, no focus target. */
export function defaultSenSurfaceState(workspaceId = "local"): SenSurfaceState {
  return {
    workspaceId,
    surface: "page",
    activeSessionId: null,
    returnFocusTarget: null,
    drafts: {},
    scrollAnchors: {},
    schemaVersion: SEN_SURFACE_SCHEMA_VERSION,
  };
}

/**
 * Version-tolerant hydration. Unknown/future versions degrade forward to v1:
 * invalid surfaces fall back to `page`, cruft is dropped, drafts/anchors are
 * re-sanitized (string / finite number only), and no extra key is carried.
 */
export function migrateSenSurfaceState(raw: unknown, fallbackWorkspace: string): SenSurfaceState {
  if (raw === null || typeof raw !== "object") return defaultSenSurfaceState(fallbackWorkspace);
  const o = raw as Record<string, unknown>;
  const surface = (o.surface as SenSurface) ;
  const surfaceNext: SenSurface =
    surface === "side-panel" || surface === "floating" || surface === "none"
      ? surface
      : "page";
  const drafts: Record<string, string> = {};
  if (o.drafts && typeof o.drafts === "object") {
    for (const [k, v] of Object.entries(o.drafts)) {
      if (typeof v === "string") drafts[k] = v;
    }
  }
  const scrollAnchors: Record<string, number> = {};
  if (o.scrollAnchors && typeof o.scrollAnchors === "object") {
    for (const [k, v] of Object.entries(o.scrollAnchors)) {
      if (typeof v === "number" && Number.isFinite(v)) scrollAnchors[k] = v;
    }
  }
  return {
    workspaceId: typeof o.workspaceId === "string" ? o.workspaceId : fallbackWorkspace,
    surface: surfaceNext,
    activeSessionId: typeof o.activeSessionId === "string" ? o.activeSessionId : null,
    returnFocusTarget: typeof o.returnFocusTarget === "string" ? o.returnFocusTarget : null,
    drafts,
    scrollAnchors,
    schemaVersion: SEN_SURFACE_SCHEMA_VERSION,
  };
}

/** Storage seam so the store stays pure; injectable for tests/adapters. */
export interface SenSurfaceStorage {
  readAll(): Record<string, SenSurfaceState>;
  writeAll(entries: Record<string, SenSurfaceState>): void;
}

/** In-memory storage (default and test double). */
export function createMemorySenSurfaceStorage(): SenSurfaceStorage {
  let entries: Record<string, SenSurfaceState> = {};
  return {
    readAll: () => entries,
    writeAll: (next) => {
      entries = next;
    },
  };
}

/**
 * Browser-local storage adapter. Each workspace is serialized under one keyed
 * record; writes are guarded so a full/private-mode quota error never throws.
 * Successful reads/persists drive no product authority — surface view state only.
 */
export function createLocalStorageSenSurfaceStorage(
  prefix = "newsos.sen-surface",
): SenSurfaceStorage {
  const read = (): Record<string, SenSurfaceState> => {
    try {
      const raw = window.localStorage.getItem(prefix);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as unknown;
      if (parsed === null || typeof parsed !== "object") return {};
      return parsed as Record<string, SenSurfaceState>;
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
        /* quota / privacy — surface prefs are disposable */
      }
    },
  };
}

/** Deterministic storage key for a workspace. */
export function senSurfaceKey(workspaceId: string): string {
  return `workspace:${workspaceId}`;
}

export interface SenSurfaceStore {
  /** Subscribe to any state change; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** Stable reference to the current state for a workspace; constant between patches. */
  getSnapshot(workspaceId: string): SenSurfaceState;
  /** Choose the presentation surface. Enforces exclusivity (page suppresses court). */
  setSurface(workspaceId: string, surface: SenSurface): SenSurfaceState;
  /** Canonical session selection; preserved across surface switches. */
  setActiveSession(workspaceId: string, sessionId: string | null): SenSurfaceState;
  /** The single derived composer owner for a workspace. */
  composerOwner(workspaceId: string): SenComposerOwner;
  /** Which surface is active for a workspace. */
  surface(workspaceId: string): SenSurface;
  /** Persist a per-session draft (survives surface switches). */
  saveDraft(workspaceId: string, sessionId: string, draft: string): void;
  /** Read a per-session draft (continuity state; not cleared on switch). */
  draft(workspaceId: string, sessionId: string): string;
  /** Persist a per-session scroll anchor (survives surface switches). */
  saveScrollAnchor(workspaceId: string, sessionId: string, anchor: number): void;
  /** Read a per-session scroll anchor. */
  scrollAnchor(workspaceId: string, sessionId: string): number;
  /** Record the focus-handoff target. */
  setReturnFocus(workspaceId: string, target: string | null): SenSurfaceState;
  /** Drop a workspace's surface state (logout / account switch, privacy). */
  clearWorkspace(workspaceId: string): void;
  /** Number of tracked workspaces (test/diagnostic). */
  stateCount(): number;
  /** Current persisted record (test/diagnostic). */
  persisted(): Record<string, SenSurfaceState>;
}

export interface SenSurfaceStoreOptions {
  storage?: SenSurfaceStorage;
}

export function createSenSurfaceStore(options: SenSurfaceStoreOptions = {}): SenSurfaceStore {
  const storage = options.storage ?? createMemorySenSurfaceStorage();

  // Hydrate once: migrate each persisted workspace entry into live memory.
  const current = new Map<string, SenSurfaceState>();
  for (const [key, value] of Object.entries(storage.readAll())) {
    const fallback = key.replace(/^workspace:/, "");
    current.set(key, migrateSenSurfaceState(value, fallback));
  }

  const listeners = new Set<() => void>();
  const emit = () => {
    for (const l of listeners) l();
  };

  const keyFor = (workspaceId: string): string => senSurfaceKey(workspaceId);

  const ensure = (workspaceId: string): SenSurfaceState => {
    const key = keyFor(workspaceId);
    let state = current.get(key);
    if (!state) {
      state = defaultSenSurfaceState(workspaceId);
      current.set(key, state);
    }
    return state;
  };

  const persistAll = () => {
    const out: Record<string, SenSurfaceState> = {};
    for (const [key, value] of current) out[key] = { ...value, drafts: { ...value.drafts }, scrollAnchors: { ...value.scrollAnchors } };
    storage.writeAll(out);
  };

  const patch = (workspaceId: string, update: Partial<SenSurfaceState>): SenSurfaceState => {
    const base = ensure(workspaceId);
    const next: SenSurfaceState = { ...base, ...update };
    current.set(keyFor(workspaceId), next);
    emit();
    return next;
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: ensure,
    setSurface(workspaceId, surface) {
      const next = patch(workspaceId, { surface });
      persistAll();
      return next;
    },
    setActiveSession(workspaceId, sessionId) {
      const next = patch(workspaceId, { activeSessionId: sessionId });
      persistAll();
      return next;
    },
    composerOwner(workspaceId) {
      return composerOwnerFor(ensure(workspaceId).surface);
    },
    surface(workspaceId) {
      return ensure(workspaceId).surface;
    },
    saveDraft(workspaceId, sessionId, draft) {
      const base = ensure(workspaceId);
      const nextDrafts = { ...base.drafts };
      if (draft) nextDrafts[sessionId] = draft;
      else delete nextDrafts[sessionId];
      current.set(keyFor(workspaceId), { ...base, drafts: nextDrafts });
      emit();
      persistAll();
    },
    draft(workspaceId, sessionId) {
      return ensure(workspaceId).drafts[sessionId] ?? "";
    },
    saveScrollAnchor(workspaceId, sessionId, anchor) {
      const base = ensure(workspaceId);
      const next = { ...base.scrollAnchors };
      if (Number.isFinite(anchor)) next[sessionId] = anchor;
      else delete next[sessionId];
      current.set(keyFor(workspaceId), { ...base, scrollAnchors: next });
      emit();
      persistAll();
    },
    scrollAnchor(workspaceId, sessionId) {
      const v = ensure(workspaceId).scrollAnchors[sessionId];
      return typeof v === "number" && Number.isFinite(v) ? v : 0;
    },
    setReturnFocus(workspaceId, target) {
      const next = patch(workspaceId, { returnFocusTarget: target });
      persistAll();
      return next;
    },
    clearWorkspace(workspaceId) {
      current.delete(keyFor(workspaceId));
      emit();
      persistAll();
    },
    stateCount() {
      return current.size;
    },
    persisted() {
      const out: Record<string, SenSurfaceState> = {};
      for (const [key, value] of current) out[key] = { ...value, drafts: { ...value.drafts }, scrollAnchors: { ...value.scrollAnchors } };
      return out;
    },
  };
}