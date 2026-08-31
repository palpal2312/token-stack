"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { MobileNav } from "@/components/Sidebar";
import InstantPageFrame from "@/components/InstantPageFrame";
import OwnerBanner from "@/components/OwnerBanner";
import CommandPalette from "@/components/CommandPalette";
import { SenPanelProvider } from "@/context/sen-panel-context";
import { NavPendingProvider, useNavPending } from "@/context/nav-pending-context";
import { QueryProvider, useQueryClient } from "@/lib/query/query-client";
import { RealtimeReconciler } from "@/lib/query/realtime-reconciler";
import { ViewHost } from "./view-host";
import { NavigationProgress } from "./navigation-progress";
import SenSurfaceCoordinator from "./sen-surface-coordinator";
import { AckSeedProvider } from "./ack-seed-provider";
import ModuleNav from "./module-nav";
import { createPrefetchController, type PrefetchController } from "./intent-prefetch";
import {
  DESKTOP_MODULES,
  findModuleByRoute,
  type DesktopModuleDefinition,
} from "./desktop-module-registry";
import {
  createPanelLayoutStore,
  panelStateKey,
  type PanelLayoutStore,
  type PanelLayoutState,
} from "./panel-layout-store";
import {
  createLocalStorageViewSessionStorage,
  createViewSessionStore,
  routePathname,
  type ViewSessionStore,
  type ViewRoute,
} from "./view-session-store";
import {
  createViewSessionCoordinator,
  type ViewSessionCoordinator,
} from "./view-session-coordinator";

/**
 * DesktopShell (Phase 19a U1) — persistent authenticated workspace shell.
 *
 * Provides the stable provider stack for nav-pending / panel / registry /
 * command / modal / toast / query / view-session exactly once per authenticated
 * workspace. Feature switching changes module content inside `ViewHost` without
 * recreating these global stores. Navigation is driven by the module registry
 * (`ModuleNav`); the active module's feature view renders through `ViewHost`.
 *
 * When the `desktop_shell_v2` flag is OFF the root layout mounts `Shell.tsx`
 * instead, so the production default is byte-equivalent. This component is only
 * mounted behind the flag.
 */

const FULL_WIDTH = new Set([
  "/sen",
  "/firstmate",
  "/code-space",
  "/agent-kanban",
  "/memory",
  "/builders",
  "/routers",
  "/integrations",
  "/goals",
  "/automations",
  "/loop",
]);

// --- Registry ----------------------------------------------------------------

interface ModuleRegistryValue {
  modules: readonly DesktopModuleDefinition[];
  find: (route: string) => DesktopModuleDefinition | undefined;
}
const ModuleRegistryContext = createContext<ModuleRegistryValue | null>(null);

export function useModuleRegistry(): ModuleRegistryValue {
  const v = useContext(ModuleRegistryContext);
  if (!v) throw new Error("useModuleRegistry must be used within DesktopShell");
  return v;
}

// --- Workspace scope ---------------------------------------------------------

const WorkspaceContext = createContext<string>("local");
export function useWorkspaceId(): string {
  return useContext(WorkspaceContext);
}

// --- Intent prefetch ---------------------------------------------------------

const IntentPrefetchContext = createContext<PrefetchController | null>(null);
export function useIntentPrefetch(): PrefetchController {
  const v = useContext(IntentPrefetchContext);
  if (!v) throw new Error("useIntentPrefetch must be used within DesktopShell");
  return v;
}

// --- Realtime reconciler -------------------------------------------------------

const RealtimeReconcilerContext = createContext<RealtimeReconciler | null>(null);
export function useRealtimeReconciler(): RealtimeReconciler {
  const r = useContext(RealtimeReconcilerContext);
  if (!r) throw new Error("useRealtimeReconciler must be used within DesktopShell");
  return r;
}

/**
 * One realtime reconcile channel per workspace (Phase 19a U3). Owns the workspace
 * sequence, apply/gap scheduling, and canonical replace over the single query
 * cache. `register()` is idempotent (never a duplicate global listener) and the
 * channel is torn down on unmount. The reconciler only touches the query cache;
 * reconnect refetch stays authoritative.
 */
function RealtimeReconcilerProvider({
  workspaceId,
  children,
}: {
  workspaceId: string;
  children: ReactNode;
}) {
  const { client } = useQueryClient();
  const ref = useRef<RealtimeReconciler | null>(null);
  if (ref.current === null) ref.current = new RealtimeReconciler({ workspaceId, client });
  const reconciler = ref.current;

  useEffect(() => {
    // One registered reconcile channel per workspace, torn down on unmount.
    const teardown = reconciler.register();
    return teardown;
  }, [reconciler]);

  return (
    <RealtimeReconcilerContext.Provider value={reconciler}>
      {children}
    </RealtimeReconcilerContext.Provider>
  );
}

// --- Panel store -------------------------------------------------------------

const PanelStoreContext = createContext<PanelLayoutStore | null>(null);
export function usePanelStore(): PanelLayoutStore {
  const v = useContext(PanelStoreContext);
  if (!v) throw new Error("usePanelStore must be used within DesktopShell");
  return v;
}

/** React binding over the external panel store for one panel in the current workspace. */
export function usePanel(panelId: string) {
  const store = usePanelStore();
  const workspaceId = useWorkspaceId();
  const key = panelStateKey(workspaceId, panelId);
  const state: PanelLayoutState = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(key),
  );
  const actions = useMemo(
    () => ({
      open: () => store.setOpen(workspaceId, panelId, true),
      close: () => store.close(workspaceId, panelId),
      toggle: () => store.toggle(workspaceId, panelId),
      setSize: (size: number) => store.setSize(workspaceId, panelId, size),
      commitSize: () => store.commitSize(workspaceId, panelId),
    }),
    [store, workspaceId, panelId],
  );
  return { state, ...actions };
}

// --- Command registry --------------------------------------------------------

interface CommandRegistryValue {
  register: (id: string, handler: () => void) => void;
  run: (id: string) => void;
}
const CommandRegistryContext = createContext<CommandRegistryValue | null>(null);
export function useCommandRegistry(): CommandRegistryValue {
  const v = useContext(CommandRegistryContext);
  if (!v) throw new Error("useCommandRegistry must be used within DesktopShell");
  return v;
}

// --- Modal registry ----------------------------------------------------------

interface ModalRegistryValue {
  activeId: string | null;
  open: (id: string) => void;
  close: () => void;
}
const ModalRegistryContext = createContext<ModalRegistryValue | null>(null);
export function useModalRegistry(): ModalRegistryValue {
  const v = useContext(ModalRegistryContext);
  if (!v) throw new Error("useModalRegistry must be used within DesktopShell");
  return v;
}

// --- Toasts ------------------------------------------------------------------

interface Toast { id: number; message: string }
interface ToastValue {
  push: (message: string) => void;
  dismiss: (id: number) => void;
}
const ToastContext = createContext<ToastValue | null>(null);
export function useToast(): ToastValue {
  const v = useContext(ToastContext);
  if (!v) throw new Error("useToast must be used within DesktopShell");
  return v;
}

// --- View session ------------------------------------------------------------

interface ViewSessionValue {
  store: ViewSessionStore;
  coordinator: ViewSessionCoordinator;
  activeTabId: string;
  activeModuleId: string;
}
const ViewSessionContext = createContext<ViewSessionValue | null>(null);
export function useViewSession(): ViewSessionValue {
  const v = useContext(ViewSessionContext);
  if (!v) throw new Error("useViewSession must be used within DesktopShell");
  return v;
}

// --- Scroll host -------------------------------------------------------------

/** Mutable reference to the shell's scrollable region (for memento capture). */
const ScrollHostContext = createContext<{ current: HTMLElement | null }>({ current: null });

// --- Provider implementations --------------------------------------------------

function CommandRegistryProvider({ children }: { children: ReactNode }) {
  const [handlers] = useState(() => new Map<string, () => void>());
  const register = useCallback((id: string, fn: () => void) => {
    handlers.set(id, fn);
  }, [handlers]);
  const run = useCallback((id: string) => {
    handlers.get(id)?.();
  }, [handlers]);
  const value = useMemo<CommandRegistryValue>(() => ({ register, run }), [register, run]);
  return <CommandRegistryContext.Provider value={value}>{children}</CommandRegistryContext.Provider>;
}

function ModalRegistryProvider({ children }: { children: ReactNode }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const open = useCallback((id: string) => setActiveId(id), []);
  const close = useCallback(() => setActiveId(null), []);
  const value = useMemo<ModalRegistryValue>(() => ({ activeId, open, close }), [activeId, open, close]);
  return <ModalRegistryContext.Provider value={value}>{children}</ModalRegistryContext.Provider>;
}

function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000);
  }, []);
  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);
  const value = useMemo<ToastValue>(() => ({ push, dismiss }), [push, dismiss]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[80] flex flex-col gap-2">
        {toasts.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => dismiss(t.id)}
            className="pointer-events-auto panel px-4 py-2 text-[13px]"
          >
            {t.message}
          </button>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ViewSessionProvider({ workspaceId, children }: { workspaceId: string; children: ReactNode }) {
  const storeRef = useRef<ViewSessionStore | null>(null);
  if (storeRef.current === null) {
    storeRef.current = createViewSessionStore({
      workspaceId,
      storage: createLocalStorageViewSessionStorage(`newsos.view-session.${workspaceId}`),
    });
  }
  const store = storeRef.current;
  // The store mutates a stable snapshot reference in place, so react to
  // notification with a force-update and re-read the active tab each render.
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
  useEffect(() => store.subscribe(forceUpdate), [store]);

  const coordRef = useRef<ViewSessionCoordinator | null>(null);
  if (coordRef.current === null) {
    coordRef.current = createViewSessionCoordinator({
      store,
      // The app router URL is already the projection of the active route; we
      // mirror it, not second-write history with a competing replace.
      replace: () => {},
      getCurrentUrl: () => "",
      resolveRoute: (url: string): ViewRoute | null => {
        const p = routePathname(url);
        const mod = findModuleByRoute(p);
        if (!mod) return null;
        return { moduleId: mod.id, url: p, titleToken: mod.titleKey };
      },
    });
  }

  const active = store.activeTab();
  const value = useMemo<ViewSessionValue>(
    () => ({
      store,
      coordinator: coordRef.current!,
      activeTabId: active.id,
      activeModuleId: active.moduleId,
    }),
    // active is re-read every render; identity of the active tab drives the memo.
    [store, active.id, active.moduleId],
  );

  return <ViewSessionContext.Provider value={value}>{children}</ViewSessionContext.Provider>;
}

/**
 * Keeps the view-session store a projection of the app router and captures /
 * restores route-scoped mementos around switches. Pull-based restore: the store
 * keeps continuity state (scroll anchor); the heavy view is NOT kept mounted.
 */
function ViewSessionSync() {
  const { store, coordinator, activeTabId } = useViewSession();
  const pathname = usePathname();
  const scrollHost = useContext(ScrollHostContext);
  const scrollNow = useRef(0);
  const prevPathRef = useRef(pathname);

  // The shell's scroll region is the <main> (or the document for short pages).
  // Resolve it lazily so it is correct regardless of ref-attachment timing.
  const scrollEl = () => {
    const main = scrollHost.current && scrollHost.current.scrollHeight > scrollHost.current.clientHeight
      ? scrollHost.current
      : document.querySelector<HTMLElement>("main");
    if (main && main.scrollHeight > main.clientHeight) return main;
    return document.scrollingElement;
  };

  useEffect(() => {
    const onScroll = () => { scrollNow.current = scrollEl()?.scrollTop ?? 0; };
    onScroll();
    document.addEventListener("scroll", onScroll, true);
    return () => document.removeEventListener("scroll", onScroll, true);
  }, []);

  useEffect(() => {
    const path = (pathname ?? "/").replace(/\/$/, "") || "/";
    const prev = prevPathRef.current;
    // The render-time active tab is the OUTGOING tab (owns `prev`).
    const outgoingTabId = activeTabId;

    // Reconcile the store with the committed route (semantic tab open/reuse).
    coordinator.handleRouteChange(path);

    if (prev !== path) {
      // Capture the outgoing route's continuity state before switching away.
      store.captureMemento(outgoingTabId, prev, { scrollAnchor: String(scrollNow.current) });
      // Pull-based restore of the incoming route from the tab that now owns it.
      const incoming = store.activeTab();
      const mem = store.restoreMemento(incoming.id, path);
      const top = Number(mem?.scrollAnchor ?? 0);
      requestAnimationFrame(() => scrollEl()?.scrollTo({ top }));
      prevPathRef.current = path;
    }
  }, [pathname, activeTabId, store, coordinator, scrollHost]);

  return null;
}

/**
 * Restores focus to the nav trigger that started a switch after the route
 * commits, so a keyboard user is not stranded at the body while the shell swaps.
 */
function FocusRestorer() {
  const { isPending } = useNavPending();
  const lastNavTargetRef = useRef<HTMLElement | null>(null);
  const wasPendingRef = useRef(false);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>("a[href]");
      if (el) lastNavTargetRef.current = el;
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, []);

  useEffect(() => {
    if (isPending) {
      wasPendingRef.current = true;
      return;
    }
    if (!wasPendingRef.current) return;
    wasPendingRef.current = false;
    const target = lastNavTargetRef.current;
    if (!target) return;
    // A just-committed view may autofocus its own input after mount (e.g. the
    // SEN composer), stealing focus back from the nav trigger. That autofocus
    // is a one-shot on mount, so a bounded series of re-asserts over ~600ms
    // lets the last one stick and wins the a11y invariant.
    const attempts = [0, 80, 200, 400, 600];
    let i = 0;
    const reassert = () => {
      if (target.isConnected) target.focus();
      i += 1;
      if (i < attempts.length) setTimeout(reassert, attempts[i] - attempts[i - 1]);
    };
    setTimeout(reassert, attempts[0]);
  }, [isPending]);

  return null;
}

// --- Shell body ---------------------------------------------------------------

function DesktopShellBody({ children, surfaceCoordinatorEnabled }: { children: ReactNode; surfaceCoordinatorEnabled: boolean }) {
  const pathname = usePathname();
  const path = (pathname ?? "/").replace(/\/$/, "") || "/";
  const { isPending, displayPath } = useNavPending();
  const prefetch = useIntentPrefetch();
  const workspaceId = useWorkspaceId();
  const framePath = isPending ? displayPath : path;
  const isFullWidth = FULL_WIDTH.has(framePath) || FULL_WIDTH.has(path);
  const mainRef = useRef<HTMLElement | null>(null);
  const scrollHost = useMemo(() => ({ current: mainRef.current }), [mainRef]);
  // Keep the ref object live per render so the sync effect always sees it.
  scrollHost.current = mainRef.current;
  const activeModuleId = findModuleByRoute(path)?.id;
  // Phase 19a U2: the SEN surface coordinator mounts ONLY under its own rollout
  // flag (resolved server-side and threaded down — a client cannot read env) and
  // ONLY on the SEN route; otherwise the legacy SenView renders as-is.
  const surfaceActive = surfaceCoordinatorEnabled && (path === "/sen" || path === "/firstmate");

  // Committed navigation wins: once a module route commits, cancel any in-flight
  // prefetch for it (so the real navigation load is the only fetch — no double
  // fetch) and mark it done so later intent for the committed module is a no-op.
  useEffect(() => {
    if (activeModuleId) prefetch.commit(activeModuleId);
  }, [prefetch, activeModuleId]);

  return (
    <ScrollHostContext.Provider value={scrollHost}>
      <ViewSessionSync />
      <FocusRestorer />
      <div className="h-screen flex overflow-hidden">
        <ModuleNav />
        <main
          ref={mainRef}
          className={`flex-1 min-w-0 ${isFullWidth ? "overflow-hidden" : "overflow-y-auto"}`}
        >
          <div className={isFullWidth ? "h-full min-h-0" : "max-w-[1500px] mx-auto px-6 md:px-10 py-8"}>
            {!isFullWidth && <OwnerBanner />}
            <CommandPalette showTrigger={false} />
            {isPending ? (
              <InstantPageFrame path={displayPath} />
            ) : surfaceActive ? (
              <ViewHost route={path}>
                <SenSurfaceCoordinator
                  workspaceId={workspaceId}
                  panelStore={usePanelStore()}
                  enabled={surfaceCoordinatorEnabled}
                >
                  {children}
                </SenSurfaceCoordinator>
              </ViewHost>
            ) : (
              <ViewHost route={path}>{children}</ViewHost>
            )}
          </div>
        </main>
        <MobileNav />
      </div>
    </ScrollHostContext.Provider>
  );
}

// --- Shell --------------------------------------------------------------------

export default function DesktopShell({
  children,
  workspaceId = "local",
  surfaceCoordinatorEnabled = false,
  fixtureEnabled = false,
}: {
  children: ReactNode;
  workspaceId?: string;
  /** Phase 19a U2 SEN surface coordinator flag, resolved server-side. */
  surfaceCoordinatorEnabled?: boolean;
  /** Phase 19a U3 QA ack-seed fixture sink, resolved server-side (OFF by default). */
  fixtureEnabled?: boolean;
}) {
  // One stable store per mounted shell — never recreated on module swaps.
  const panelStoreRef = useRef<PanelLayoutStore | null>(null);
  if (panelStoreRef.current === null) panelStoreRef.current = createPanelLayoutStore();

  // One stable intent-prefetch controller per shell (never recreated on module
  // swaps), so in-flight prefetches survive feature switching.
  const prefetchRef = useRef<PrefetchController | null>(null);
  if (prefetchRef.current === null) prefetchRef.current = createPrefetchController();

  const registryValue = useMemo<ModuleRegistryValue>(
    () => ({ modules: DESKTOP_MODULES, find: findModuleByRoute }),
    [],
  );

  return (
    <QueryProvider>
      <RealtimeReconcilerProvider workspaceId={workspaceId}>
      <AckSeedProvider workspaceId={workspaceId} fixtureEnabled={fixtureEnabled}>
      <ModuleRegistryContext.Provider value={registryValue}>
        <WorkspaceContext.Provider value={workspaceId}>
          <IntentPrefetchContext.Provider value={prefetchRef.current}>
          <SenPanelProvider>
            <NavPendingProvider>
              <PanelStoreContext.Provider value={panelStoreRef.current}>
                <CommandRegistryProvider>
                  <ModalRegistryProvider>
                    <ToastProvider>
                      <ViewSessionProvider workspaceId={workspaceId}>
                        <NavigationProgress />
                        <DesktopShellBody surfaceCoordinatorEnabled={surfaceCoordinatorEnabled}>
                          {children}
                        </DesktopShellBody>
                      </ViewSessionProvider>
                    </ToastProvider>
                  </ModalRegistryProvider>
                </CommandRegistryProvider>
              </PanelStoreContext.Provider>
            </NavPendingProvider>
          </SenPanelProvider>
          </IntentPrefetchContext.Provider>
        </WorkspaceContext.Provider>
      </ModuleRegistryContext.Provider>
      </AckSeedProvider>
      </RealtimeReconcilerProvider>
    </QueryProvider>
  );
}