/**
 * View session store (Phase 19a U1).
 *
 * The disposable view-state authority for logical tabs: which tabs exist in a
 * workspace, which is active, pin/reorder, per-route mementos, and schema
 * migration. It intentionally mirrors NO server/query/runtime state — canonical
 * session, realtime, and execution authority live elsewhere (Phase 8b, the
 * query cache, Go). See Phase 19a "Logical tabs" invariant: workspace-scoped
 * groups, virtual history, versioned mementos, semantic route reuse,
 * pin/reorder/close and deterministic router reconciliation.
 *
 * Contract invariants (Phase 19a "Persistent shell and panel state machine"):
 *   - Workspace-scoped, schema-versioned, size-limited, SECRET-FREE.
 *   - Corrupt / oversized / unknown-version persisted state SELF-HEALS to a
 *     safe default SEN/home session. This module never throws and never
 *     serializes cargo it was not explicitly given: hydration strips unknown
 *     keys, so no secret can round-trip through the stored record.
 *   - Persistence is a raw-key localStorage wrapper behind an injectable
 *     storage seam; reads are cached in memory at construction.
 *   - The app router URL is a PROJECTION of the active session (see
 *     view-session-coordinator.ts); this store is the only writer of tab/history.
 *
 * This module is pure (no React, no Next.js, no DOM) and unit-testable under
 * node:test, mirroring `desktop-module-registry.ts` and `panel-layout-store.ts`.
 */

/** Bump when the persisted record shape changes; every version must migrate. */
export const VIEW_SESSION_SCHEMA_VERSION = 1 as const;

/** Hard cap on logical tabs per workspace (size limit). */
export const MAX_TABS = 12;

/** Default home module when nothing is recoverable. */
export const HOME_MODULE_ID = "sen" as const;
export const HOME_TITLE_TOKEN = "nav.sen" as const;

/** Per-route memento: pull-based continuity state (scroll anchor / query params). */
export interface RouteMemento {
  scrollAnchor?: string;
  queryParams?: Record<string, string>;
}

/**
 * A single logical tab. Optional `terminalSessionId` holds durable attach
 * identity only — never PTY/process ownership (renderer never serializes a
 * secret here; hydration strips extraneous keys).
 */
export interface ViewSession {
  id: string;
  workspaceId: string;
  moduleId: string;
  url: string;
  titleToken: string;
  pinned: boolean;
  /** Virtual history: pushed route urls for this tab (newest last). */
  history: string[];
  /** Per-route mementos, keyed by normalized route pathname. */
  memento: Record<string, RouteMemento>;
  terminalSessionId?: string;
  schemaVersion: typeof VIEW_SESSION_SCHEMA_VERSION;
}

/** The persisted shape for one workspace. */
export interface ViewSessionStoreState {
  schemaVersion: typeof VIEW_SESSION_SCHEMA_VERSION;
  workspaceId: string;
  activeTabId: string;
  tabs: ViewSession[];
}

/** A route descriptor used to open/activate a tab. */
export interface ViewRoute {
  moduleId: string;
  url: string;
  titleToken: string;
}

/** Storage seam so the store stays pure; injectable for tests/adapters. */
export interface ViewSessionStorage {
  read(): string | null;
  write(raw: string): void;
  remove(): void;
}

/** In-memory storage (default and test double). */
export function createMemoryViewSessionStorage(): ViewSessionStorage {
  let value: string | null = null;
  return {
    read: () => value,
    write: (raw) => { value = raw; },
    remove: () => { value = null; },
  };
}

/**
 * Browser-local storage adapter. One key per store/workspace; writes are
 * guarded so a full/private-mode quota error never throws. Drives no product
 * authority — view state only.
 */
export function createLocalStorageViewSessionStorage(
  prefix = "newsos.view-session",
): ViewSessionStorage {
  return {
    read: () => {
      try {
        return window.localStorage.getItem(prefix);
      } catch {
        return null;
      }
    },
    write(raw) {
      try {
        window.localStorage.setItem(prefix, raw);
      } catch {
        /* quota / privacy — view prefs are disposable */
      }
    },
    remove() {
      try {
        window.localStorage.removeItem(prefix);
      } catch {
        /* noop */
      }
    },
  };
}

let idSeq = 0;

/** Collision-resistant, deterministic-ish id for a new tab. */
export function createTabId(prefix = "tab"): string {
  idSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${idSeq.toString(36)}`;
}

/**
 * Normalize a route url: ensure leading slash, collapse duplicate slashes,
 * strip a trailing slash (except root), keep scheme://host if absolute.
 */
export function normalizeRouteUrl(raw: string): string {
  let s = String(raw ?? "").trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    // absolute — leave the authority, normalize the rest below
  } else if (!s.startsWith("/")) {
    s = "/" + s;
  }
  // Collapse interior duplicate slashes, but never the "//" of a scheme or
  // authority (https://host stays intact).
  s = s.replace(/([^:/])\/{2,}/g, "$1/");
  if (s.length > 1) s = s.replace(/\/$/, "");
  return s || "/";
}

/**
 * Pathname of a route url (query/hash stripped, leading slash, scheme+host
 * removed) — the stable key for "route" semantics and per-route mementos.
 */
export function routePathname(raw: string): string {
  const s = normalizeRouteUrl(raw);
  const auth = s.match(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i);
  let path = auth ? s.slice((auth[0] as string).length) : s;
  const qi = path.indexOf("?");
  const hi = path.indexOf("#");
  let end = path.length;
  if (qi !== -1 && (hi === -1 || qi < hi)) end = qi;
  if (hi !== -1 && (qi === -1 || hi < qi)) end = hi;
  path = path.slice(0, end);
  return path === "" ? "/" : path;
}

/** Semantic identity of a tab's place: module + normalized route path. */
export function routeKey(moduleId: string, url: string): string {
  return `${moduleId}::${routePathname(url)}`;
}

/** Safe default SEN/home session record. */
export function defaultViewSession(workspaceId: string): ViewSession {
  return {
    id: createTabId("sen"),
    workspaceId,
    moduleId: HOME_MODULE_ID,
    url: `/${HOME_MODULE_ID}`,
    titleToken: HOME_TITLE_TOKEN,
    pinned: false,
    history: [`/${HOME_MODULE_ID}`],
    memento: {},
    schemaVersion: VIEW_SESSION_SCHEMA_VERSION,
  };
}

/** Safe default state: exactly one SEN/home tab, active. */
export function defaultViewSessionState(workspaceId = "local"): ViewSessionStoreState {
  const tab = defaultViewSession(workspaceId);
  return {
    schemaVersion: VIEW_SESSION_SCHEMA_VERSION,
    workspaceId,
    activeTabId: tab.id,
    tabs: [tab],
  };
}

function sanitizeMemento(raw: unknown): Record<string, RouteMemento> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, RouteMemento> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === null || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;
    const entry: RouteMemento = {};
    if (typeof v.scrollAnchor === "string") entry.scrollAnchor = v.scrollAnchor;
    if (v.queryParams && typeof v.queryParams === "object") {
      const qp: Record<string, string> = {};
      for (const [k, qv] of Object.entries(v.queryParams)) {
        if (typeof qv === "string") qp[k] = qv;
      }
      if (Object.keys(qp).length > 0) entry.queryParams = qp;
    }
    out[key] = entry;
  }
  return out;
}

/**
 * Validate/sanitize a single tab record. Returns null when the record is not a
 * usable tab (dropped by hydration). Unknown keys are stripped so no secret
 * cargo can persist.
 */
export function sanitizeTab(raw: unknown, workspaceId: string, index: number): ViewSession | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const moduleId = typeof o.moduleId === "string" && o.moduleId ? o.moduleId : null;
  if (!moduleId) return null;
  const url = typeof o.url === "string" ? normalizeRouteUrl(o.url) : null;
  if (!url) return null;
  const titleToken = typeof o.titleToken === "string" ? o.titleToken : moduleId;
  const terminalSessionId = typeof o.terminalSessionId === "string" ? o.terminalSessionId : undefined;
  const history = Array.isArray(o.history)
    ? o.history.filter((h): h is string => typeof h === "string").map(normalizeRouteUrl)
    : [];
  if (history.length === 0) history.push(url);
  return {
    id: typeof o.id === "string" && o.id ? o.id : createTabId("tab"),
    workspaceId,
    moduleId,
    url,
    titleToken,
    pinned: o.pinned === true,
    history,
    memento: sanitizeMemento(o.memento),
    ...(terminalSessionId !== undefined ? { terminalSessionId } : {}),
    schemaVersion: VIEW_SESSION_SCHEMA_VERSION,
  };
}

/**
 * Legacy v0 persisted shape → v1 candidate. Legacy tabs had the shape
 * `{ key, route, title, pinned }` and the record carried no schemaVersion.
 */
function migrateV0(raw: Record<string, unknown>): ViewSessionStoreState {
  const workspaceId = typeof raw.workspaceId === "string" ? raw.workspaceId : "local";
  const legacyTabs = Array.isArray(raw.tabs) ? raw.tabs : [];
  const tabs = legacyTabs
    .map((t, i) => {
      if (!t || typeof t !== "object") return null;
      const o = t as Record<string, unknown>;
      const moduleId = typeof o.key === "string" ? o.key : null;
      return sanitizeTab(
        {
          moduleId,
          url: o.route,
          titleToken: o.title,
          pinned: o.pinned === true,
          history: typeof o.route === "string" ? [o.route] : [],
        },
        workspaceId,
        i,
      );
    })
    .filter((t): t is ViewSession => t !== null);
  const activeKey = typeof raw.activeRoute === "string" ? raw.activeRoute : undefined;
  const activeTabId =
    tabs.find((t) => t.url === activeKey)?.id ?? (tabs[0] ? tabs[0].id : "");
  const state: ViewSessionStoreState = {
    schemaVersion: VIEW_SESSION_SCHEMA_VERSION,
    workspaceId,
    activeTabId,
    tabs,
  };
  return state;
}

/** Record-level validation: version tolerance, corruption, and size cap. */
function sanitizeState(raw: unknown, workspaceId: string): ViewSessionStoreState | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const version = o.schemaVersion;
  // Unknown/future version → not recoverable → caller self-heals to default.
  if (version !== undefined && version !== null && version !== 0 && version !== VIEW_SESSION_SCHEMA_VERSION) {
    return null;
  }
  const candidate = version === 0 || version === undefined || version === null
    ? migrateV0(o)
    : (o as unknown as ViewSessionStoreState);

  const ws = typeof candidate.workspaceId === "string" ? candidate.workspaceId : workspaceId;
  if (!Array.isArray(candidate.tabs)) return null;

  // Oversized persisted state self-heals to the safe default (spec: size cap).
  if (candidate.tabs.length > MAX_TABS) return null;

  // Corrupt individual tabs are dropped; zero usable tabs → self-heal.
  const tabs = candidate.tabs
    .map((t, i) => sanitizeTab(t, ws, i))
    .filter((t): t is ViewSession => t !== null);
  if (tabs.length === 0) return null;

  const ids = new Set<string>();
  for (const t of tabs) {
    if (ids.has(t.id)) return null; // duplicate ids → not recoverable
    ids.add(t.id);
  }

  const activeTabId =
    typeof candidate.activeTabId === "string" && ids.has(candidate.activeTabId)
      ? candidate.activeTabId
      : tabs[0]!.id;

  return {
    schemaVersion: VIEW_SESSION_SCHEMA_VERSION,
    workspaceId: ws,
    activeTabId,
    tabs,
  };
}

/**
 * Deterministic hydration of a persisted payload. Never throws; on any
 * corrupt / oversized / unknown-version input falls back to the safe default
 * SEN/home session. Returns the best recoverable valid state otherwise.
 */
export function hydrateViewSessionState(raw: unknown, workspaceId = "local"): ViewSessionStoreState {
  return sanitizeState(raw, workspaceId) ?? defaultViewSessionState(workspaceId);
}

export interface ViewSessionStoreOptions {
  workspaceId?: string;
  storage?: ViewSessionStorage;
  maxTabs?: number;
}

export interface ViewSessionStore {
  /** Subscribe to any state change; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** Stable reference to the current full state. */
  getSnapshot(): ViewSessionStoreState;
  /** Active tab (never undefined — falls back to the default SEN tab). */
  activeTab(): ViewSession;
  /** All tabs in order. */
  tabs(): readonly ViewSession[];
  /** Semantic tab reuse: reuse a non-pinned tab for the same module+route. */
  open(route: ViewRoute): ViewSession;
  activate(tabId: string): ViewSession;
  pin(tabId: string): ViewSession;
  unpin(tabId: string): ViewSession;
  /** Move a tab to a 0-based index (clamped), maintaining order elsewhere. */
  reorder(tabId: string, toIndex: number): ViewSession;
  close(tabId: string): void;
  /** Record a route-scoped memento (call before unmount of the heavy view). */
  captureMemento(tabId: string, url: string, memento: RouteMemento): void;
  /** Pull-based restore (returns a copy; does not consume). */
  restoreMemento(tabId: string, url: string): RouteMemento | undefined;
  setTerminalSession(tabId: string, terminalSessionId: string): ViewSession;
  clearTerminalSession(tabId: string): ViewSession;
  /** Drop the workspace (logout / account switch, privacy). */
  clearWorkspace(): void;
  stateCount(): number;
  /** Current persisted record (test/diagnostic). */
  persisted(): ViewSessionStoreState;
}

export function createViewSessionStore(options: ViewSessionStoreOptions = {}): ViewSessionStore {
  const workspaceId = options.workspaceId ?? "local";
  const storage = options.storage ?? createMemoryViewSessionStorage();
  const maxTabs = options.maxTabs ?? MAX_TABS;

  // Memory-cache reads: hydrate once at construction.
  let raw: string | null;
  try {
    raw = storage.read();
  } catch {
    raw = null;
  }
  let parsed: unknown;
  if (raw !== null) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  } else {
    parsed = null;
  }
  // If the stored workspace doesn't match this store, start fresh (privacy).
  if (parsed !== null && typeof parsed === "object" && (parsed as Record<string, unknown>).workspaceId !== workspaceId) {
    parsed = null;
  }
  const current = hydrateViewSessionState(parsed, workspaceId);

  const listeners = new Set<() => void>();
  const emit = () => {
    for (const l of listeners) l();
  };

  const persist = () => {
    try {
      storage.write(JSON.stringify(current));
    } catch {
      /* view prefs are disposable */
    }
  };

  const find = (tabId: string): ViewSession | undefined => current.tabs.find((t) => t.id === tabId);

  const setActive = (tabId: string): ViewSession => {
    const tab = find(tabId) ?? current.tabs[0]!;
    current.activeTabId = tab.id;
    return tab;
  };

  const currentActive = (): ViewSession => find(current.activeTabId) ?? current.tabs[0]!;

  const returnTab = (tab: ViewSession): ViewSession => {
    current.activeTabId = tab.id;
    return tab;
  };

  /** Evict the oldest (lowest index) non-pinned tab to make room. */
  const evictOne = (): boolean => {
    const idx = current.tabs.findIndex((t) => !t.pinned);
    if (idx === -1) return false; // all pinned — cannot make room without closing a pinned tab
    current.tabs.splice(idx, 1);
    return true;
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => current,
    activeTab() {
      return find(current.activeTabId) ?? current.tabs[0]!;
    },
    tabs() {
      return current.tabs;
    },
    open(route) {
      const want = routeKey(route.moduleId, route.url);
      // Semantic tab reuse: a non-pinned tab for the same module+route is reused.
      const existing = current.tabs.find((t) => !t.pinned && routeKey(t.moduleId, t.url) === want);
      if (existing) {
        existing.url = normalizeRouteUrl(route.url);
        existing.titleToken = route.titleToken;
        if (existing.history[existing.history.length - 1] !== existing.url) existing.history.push(existing.url);
        persist();
        return returnTab(existing);
      }
      if (current.tabs.length >= maxTabs) {
        if (!evictOne()) {
          // All tabs pinned and at cap: activate the matching module if any,
          // else the active tab. ponytail: pins are user-guaranteed; refusing to
          // evict a pinned tab is the safe default, revisit if per-tab LRU is wanted.
          const fallback = current.tabs.find((t) => t.moduleId === route.moduleId) ?? currentActive();
          persist();
          return returnTab(fallback);
        }
      }
      const tab: ViewSession = {
        id: createTabId("tab"),
        workspaceId,
        moduleId: route.moduleId,
        url: normalizeRouteUrl(route.url),
        titleToken: route.titleToken,
        pinned: false,
        history: [normalizeRouteUrl(route.url)],
        memento: {},
        schemaVersion: VIEW_SESSION_SCHEMA_VERSION,
      };
      current.tabs.push(tab);
      persist();
      return returnTab(tab);
    },
    activate(tabId) {
      const tab = setActive(tabId);
      persist();
      return tab;
    },
    pin(tabId) {
      const tab = find(tabId);
      if (tab) {
        tab.pinned = true;
        persist();
      }
      return tab ?? currentActive();
    },
    unpin(tabId) {
      const tab = find(tabId);
      if (tab) {
        tab.pinned = false;
        persist();
      }
      return tab ?? currentActive();
    },
    reorder(tabId, toIndex) {
      const from = current.tabs.findIndex((t) => t.id === tabId);
      if (from === -1) return currentActive();
      const target = Math.max(0, Math.min(toIndex, current.tabs.length - 1));
      if (from === target) {
        current.activeTabId = tabId;
        return current.tabs[from]!;
      }
      const [moved] = current.tabs.splice(from, 1);
      current.tabs.splice(target, 0, moved!);
      persist();
      return moved!;
    },
    close(tabId) {
      const idx = current.tabs.findIndex((t) => t.id === tabId);
      if (idx === -1) return;
      const wasActive = current.activeTabId === tabId;
      current.tabs.splice(idx, 1);
      if (current.tabs.length === 0) {
        // Safe default SEN/home session returns when the last tab closes.
        current.tabs.push(defaultViewSession(workspaceId));
        current.activeTabId = current.tabs[0]!.id;
      } else if (wasActive) {
        setActive(current.tabs[Math.min(idx, current.tabs.length - 1)]!.id);
      }
      persist();
    },
    captureMemento(tabId, url, memento) {
      const tab = find(tabId);
      if (!tab) return;
      tab.memento[routePathname(url)] = {
        scrollAnchor: memento.scrollAnchor,
        ...(memento.queryParams ? { queryParams: { ...memento.queryParams } } : {}),
      };
      persist();
    },
    restoreMemento(tabId, url) {
      const tab = find(tabId);
      const entry = tab?.memento[routePathname(url)];
      if (!entry) return undefined;
      return {
        ...(entry.scrollAnchor !== undefined ? { scrollAnchor: entry.scrollAnchor } : {}),
        ...(entry.queryParams ? { queryParams: { ...entry.queryParams } } : {}),
      };
    },
    setTerminalSession(tabId, terminalSessionId) {
      const tab = find(tabId);
      if (tab) {
        tab.terminalSessionId = terminalSessionId;
        persist();
      }
      return tab ?? currentActive();
    },
    clearTerminalSession(tabId) {
      const tab = find(tabId);
      if (tab) {
        delete tab.terminalSessionId;
        persist();
      }
      return tab ?? currentActive();
    },
    clearWorkspace() {
      try {
        storage.remove();
      } catch {
        /* noop */
      }
      const fresh = defaultViewSessionState(workspaceId);
      current.schemaVersion = fresh.schemaVersion;
      current.workspaceId = fresh.workspaceId;
      current.activeTabId = fresh.activeTabId;
      current.tabs = fresh.tabs;
      emit();
      persist();
    },
    stateCount() {
      return current.tabs.length;
    },
    persisted() {
      return current;
    },
  };
}