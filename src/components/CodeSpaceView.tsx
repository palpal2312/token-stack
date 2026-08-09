"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { RefreshCw, AlertTriangle, PanelLeft, PanelLeftClose, SquareTerminal, ExternalLink, Code, ChevronDown } from "lucide-react";
import DebugShell from "./DebugShell";
import HeaderStatPills from "./HeaderStatPills";
import PageHeaderIcon from "./PageHeaderIcon";
import { apiFetch } from "@/lib/apiFetch";
import {
  CachePresets,
  ClientCacheKeys,
  cachedFetchJson,
  invalidateCache,
  readCache,
} from "@/lib/client-data-cache";

// Code Space surfaces running job status and descriptions. The live terminal is
// opt-in via Debug Shell (or Open Terminal for a separate CMD window running Herdr).
// Closing this tab does not stop Herdr panes — that is the point of attaching
// to a real multiplexer.

interface Pane {
  pane_id?: string;
  agent?: string;
  agent_status?: string;
  cwd?: string;
  terminal_title?: string;
  terminal_title_stripped?: string;
}
interface Workspace { workspace_id: string; label?: string }
interface Status { installed: boolean; bin: string | null; version: string | null; running: boolean; error: string | null }
interface RuntimeAttempt {
  attempt_id: string;
  task_id: string;
  builder_id: string;
  pane_id: string;
  status: "pending" | "attached" | "completed" | "failed" | "cancelled";
  last_heartbeat_at: string;
  terminal_summary?: string;
}

const LS_PANEL = "agentos.code-space.left-open";
const ATTACHED_ATTEMPT = new Set<RuntimeAttempt["status"]>(["pending", "attached"]);
const DONE_ATTEMPT = new Set<RuntimeAttempt["status"]>(["completed", "failed", "cancelled"]);

/** Idle board: only refetch when lastUpdate is this old while the page is open. */
const IDLE_STALE_MS = 60_000;
/** Active attached/busy session: shorter stale window — still not a continuous force poll. */
const LIVE_STALE_MS = 10_000;

type StatusSectionId = "attached" | "idle" | "done";

function formatWhen(isoOrMs: string | number | null | undefined): string {
  if (isoOrMs == null) return "never";
  const t = typeof isoOrMs === "number" ? isoOrMs : Date.parse(isoOrMs);
  if (!Number.isFinite(t)) return "never";
  return new Date(t).toLocaleString();
}

function formatAgeShort(isoOrMs: string | number | null | undefined, now = Date.now()): string {
  if (isoOrMs == null) return "never";
  const t = typeof isoOrMs === "number" ? isoOrMs : Date.parse(isoOrMs);
  if (!Number.isFinite(t)) return "never";
  const sec = Math.max(0, Math.round((now - t) / 1000));
  if (sec < 45) return "just now";
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
  return `${Math.round(sec / 86400)}d ago`;
}

function isRealTimestamp(value: string | undefined): boolean {
  if (!value) return false;
  const t = Date.parse(value);
  return Number.isFinite(t) && t > 0 && new Date(t).getUTCFullYear() >= 2000;
}

function paneStatus(pane: Pane): string {
  return (pane.agent_status || "running").toLowerCase();
}

function isIdlePane(pane: Pane): boolean {
  return paneStatus(pane) === "idle";
}

function sortByName<T>(items: T[], nameOf: (item: T) => string): T[] {
  return [...items].sort((a, b) =>
    nameOf(a).localeCompare(nameOf(b), undefined, { sensitivity: "base" }),
  );
}

export default function CodeSpaceView({ embedded = false }: { embedded?: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [panes, setPanes] = useState<Pane[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [runtimeAttempts, setRuntimeAttempts] = useState<RuntimeAttempt[]>([]);
  const [runtimeProjectionEnabled, setRuntimeProjectionEnabled] = useState(false);
  const [runtimeProjectionError, setRuntimeProjectionError] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [listUpdatedAt, setListUpdatedAt] = useState<number | null>(null);
  const [openingExt, setOpeningExt] = useState(false);
  const [extMsg, setExtMsg] = useState<string | null>(null);
  const [debugShellOpen, setDebugShellOpen] = useState(false);
  const [leftOpen, setLeftOpen] = useState(true);
  const [leftReady, setLeftReady] = useState(false);
  const listUpdatedAtRef = useRef<number | null>(null);
  const liveWorkRef = useRef(false);
  const mountedRef = useRef(true);
  const loadInFlightRef = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_PANEL);
      if (raw === "0") setLeftOpen(false);
      if (raw === "1") setLeftOpen(true);
    } catch { /* ignore */ }
    setLeftReady(true);
  }, []);
  useEffect(() => {
    if (!leftReady) return;
    try { localStorage.setItem(LS_PANEL, leftOpen ? "1" : "0"); } catch { /* ignore */ }
  }, [leftOpen, leftReady]);

  const openExternal = useCallback(async () => {
    setOpeningExt(true);
    setExtMsg(null);
    try {
      const r = await apiFetch("/api/herdr/open-external", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const j = await r.json().catch(() => ({})) as { ok?: boolean; error?: string; via?: string };
      if (!r.ok || !j.ok) {
        setExtMsg(String(j.error ?? "Could not open an external terminal."));
        return;
      }
      setExtMsg(j.via === "cmd" ? "Opened Herdr in a CMD window." : "Opened Herdr in a system terminal.");
    } catch (e) {
      setExtMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setOpeningExt(false);
    }
  }, []);

  const rememberListTime = useCallback((ms = Date.now()) => {
    listUpdatedAtRef.current = ms;
    setListUpdatedAt(ms);
  }, []);

  const applySnapshot = useCallback((j: Record<string, unknown>, fetchedAt = Date.now()) => {
    setStatus((j.status as Status) ?? null);
    const snap = j.snapshot as { panes?: Pane[]; workspaces?: Workspace[] } | null;
    setPanes(snap?.panes ?? []);
    setWorkspaces(snap?.workspaces ?? []);
    setRuntimeAttempts((j.runtimeAttempts as RuntimeAttempt[]) ?? []);
    setRuntimeProjectionEnabled(j.runtimeProjectionEnabled === true);
    setRuntimeProjectionError((j.runtimeProjectionError as string) ?? null);
    setErr((j.snapshotError as string) ?? null);
    setLoaded(true);
    rememberListTime(fetchedAt);
  }, [rememberListTime]);

  const load = useCallback(async (opts?: { force?: boolean }) => {
    if (loadInFlightRef.current && !opts?.force) return;
    const policy = CachePresets.live;
    const key = ClientCacheKeys.herdrSnapshot;

    if (!opts?.force) {
      const hit = readCache<Record<string, unknown>>(key, policy);
      if (hit?.usable) {
        applySnapshot(hit.data, Date.now() - hit.ageMs);
        if (hit.fresh) return;
      }
    } else {
      invalidateCache(key);
    }

    loadInFlightRef.current = true;
    setRefreshing(true);
    try {
      const { data: j } = await cachedFetchJson(
        key,
        async () => {
          try {
            return await (await fetch("/api/herdr/snapshot", { cache: "no-store" })).json() as Record<string, unknown>;
          } catch {
            return { error: "The dashboard did not answer." };
          }
        },
        { ...policy, force: true },
      );
      if (mountedRef.current) applySnapshot(j, Date.now());
    } finally {
      loadInFlightRef.current = false;
      if (mountedRef.current) setRefreshing(false);
    }
  }, [applySnapshot]);

  /** Fetch only when lastUpdate is past the stale window for the current session mode. */
  const refreshIfStale = useCallback((opts?: { force?: boolean }) => {
    if (opts?.force) {
      void load({ force: true });
      return;
    }
    if (document.visibilityState !== "visible") return;
    const updated = listUpdatedAtRef.current;
    const threshold = liveWorkRef.current ? LIVE_STALE_MS : IDLE_STALE_MS;
    if (updated != null && Date.now() - updated < threshold) return;
    void load();
  }, [load]);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => { mountedRef.current = false; };
  }, [load]);

  // Arm a single timeout to the next stale boundary — no continuous force poll.
  // Live attached/busy sessions use LIVE_STALE_MS; idle boards use IDLE_STALE_MS.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const arm = () => {
      if (timer) clearTimeout(timer);
      if (!mountedRef.current || document.visibilityState !== "visible") return;
      const updated = listUpdatedAtRef.current ?? Date.now();
      const threshold = liveWorkRef.current ? LIVE_STALE_MS : IDLE_STALE_MS;
      const wait = Math.max(750, threshold - (Date.now() - updated));
      timer = setTimeout(() => {
        refreshIfStale();
        arm();
      }, wait);
    };
    arm();
    const onVis = () => {
      if (document.visibilityState === "visible") {
        refreshIfStale();
        arm();
      } else if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refreshIfStale, listUpdatedAt]);

  const agentPanes = useMemo(() => panes.filter((p) => p.agent), [panes]);
  const attachedAttempts = useMemo(
    () => sortByName(
      runtimeAttempts.filter((a) => ATTACHED_ATTEMPT.has(a.status)),
      (a) => a.builder_id || a.attempt_id,
    ),
    [runtimeAttempts],
  );
  const doneAttempts = useMemo(
    () => sortByName(
      runtimeAttempts.filter((a) => DONE_ATTEMPT.has(a.status)),
      (a) => a.builder_id || a.attempt_id,
    ),
    [runtimeAttempts],
  );
  const busyPanes = useMemo(
    () => sortByName(
      agentPanes.filter((p) => !isIdlePane(p)),
      (p) => p.terminal_title_stripped || p.terminal_title || p.agent || "",
    ),
    [agentPanes],
  );
  const idlePanes = useMemo(
    () => sortByName(
      agentPanes.filter(isIdlePane),
      (p) => p.terminal_title_stripped || p.terminal_title || p.agent || "",
    ),
    [agentPanes],
  );
  const jobCount = attachedAttempts.length + busyPanes.length;
  liveWorkRef.current = jobCount > 0;

  const jobBoard = (
    <JobBoard
      compact={embedded}
      attachedAttempts={attachedAttempts}
      doneAttempts={doneAttempts}
      busyPanes={busyPanes}
      idlePanes={idlePanes}
      onOpenDebug={() => setDebugShellOpen(true)}
    />
  );

  if (embedded) {
    return (
      <div className="space-y-3">
        {err && (
          <div className="panel p-3 flex items-start gap-2.5">
            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-rose-300" />
            <div className="text-[12px] text-rose-300">{err}</div>
          </div>
        )}
        {runtimeProjectionError && (
          <div className="panel p-3 flex items-start gap-2.5">
            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-300" />
            <div className="text-[12px] text-amber-200">Canonical runtime projection: {runtimeProjectionError}</div>
          </div>
        )}
        {loaded && status && !status.running && (
          <StatusHint status={status} />
        )}
        <div className="flex items-center justify-between gap-2">
          <div className="grid grid-cols-3 gap-3 flex-1 min-w-0">
            <Stat label="Active jobs" value={String(jobCount)} accent="#22d3ee" compact />
            <Stat label="Panes open" value={String(panes.length)} accent="#a855f7" compact />
            <Stat label="Workspaces" value={String(workspaces.length)} accent="#86efac" compact />
          </div>
          <button
            type="button"
            onClick={() => setDebugShellOpen(true)}
            title="Open debug shell"
            className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-mid)] px-3 text-[12px] font-medium text-[var(--cream-mute)] transition hover:text-[var(--cream)]"
          >
            <Code size={13} /> Debug Shell
          </button>
        </div>
        {jobBoard}
        {debugShellOpen && (
          <DebugShell open={debugShellOpen} onClose={() => setDebugShellOpen(false)} />
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col h-full px-4 md:px-6 py-3">
      <header className="flex shrink-0 flex-wrap items-center gap-3 mb-3">
        <button
          type="button"
          onClick={() => setLeftOpen((v) => !v)}
          className="grid h-9 w-9 place-items-center rounded-xl border transition hover:bg-white/5"
          style={{ borderColor: "var(--line-soft)", color: "var(--cream-mute)" }}
          title={leftOpen ? "Minimize status panel" : "Expand status panel"}
          aria-expanded={leftOpen}
        >
          {leftOpen ? <PanelLeftClose size={16} /> : <PanelLeft size={16} />}
        </button>
        <PageHeaderIcon gradient="linear-gradient(135deg,#818cf8,#6366f1)">
          <SquareTerminal size={18} />
        </PageHeaderIcon>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-[var(--cream)]">
            Code Space
            <span
              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium"
              style={{
                borderColor: status?.running ? "rgba(90,184,150,.45)" : "var(--line-soft)",
                color: status?.running ? "#5ab896" : "var(--cream-mute)",
                background: status?.running ? "rgba(90,184,150,.10)" : "transparent",
              }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: status?.running ? "#5ab896" : "#6e6353" }} />
              {status?.running ? "Live" : loaded ? "Idle" : "…"}
            </span>
            <HeaderStatPills
              stats={[
                { label: `${jobCount} jobs`, tone: jobCount ? "ok" : "neutral" },
                { label: `${agentPanes.length} agents`, tone: agentPanes.length ? "ok" : "neutral" },
                { label: `${panes.length} panes`, tone: panes.length ? "accent" : "neutral" },
                { label: `${workspaces.length} workspaces`, tone: workspaces.length ? "accent" : "neutral" },
              ]}
            />
          </div>
        </div>
        <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">
          <div
            className="text-[10px] text-[var(--fg-dimmer)] text-right leading-snug hidden sm:block"
            title={[
              listUpdatedAt ? `Snapshot last update ${formatWhen(listUpdatedAt)}` : "Snapshot not loaded yet",
              jobCount > 0
                ? `Live session mode · refresh when older than ${LIVE_STALE_MS / 1000}s`
                : `Idle mode · refresh when older than ${IDLE_STALE_MS / 1000}s`,
              "No continuous force poll — only when this page is open and lastUpdate is stale.",
            ].join("\n")}
          >
            <div>Updated · {listUpdatedAt ? formatAgeShort(listUpdatedAt) : "—"}</div>
            <div>{jobCount > 0 ? "Live · 10s stale" : "Idle · 60s stale"}</div>
          </div>
          <button
            type="button"
            onClick={() => void openExternal()}
            disabled={openingExt || (loaded && status !== null && !status.installed)}
            title="Open Herdr in a separate CMD window"
            className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-mid)] px-3 text-[12px] font-medium text-[var(--cream-mute)] transition hover:text-[var(--cream)] disabled:opacity-40"
          >
            <ExternalLink size={13} /> {openingExt ? "Opening…" : "Open Terminal"}
          </button>
          <button
            type="button"
            onClick={() => setDebugShellOpen(true)}
            title="Open debug shell for a manual terminal"
            className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-mid)] px-3 text-[12px] font-medium text-[var(--cream-mute)] transition hover:text-[var(--cream)]"
          >
            <Code size={13} /> Debug Shell
          </button>
          <button
            type="button"
            onClick={() => void load({ force: true })}
            disabled={refreshing}
            title="Force fetch — bypass cache and reload Herdr snapshot now"
            className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-mid)] px-3 text-[12px] font-medium text-[var(--cream-mute)] transition hover:text-[var(--cream)] disabled:opacity-50"
          >
            <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} /> Force fetch
          </button>
        </div>
      </header>
      {extMsg && (
        <div className="mb-2 shrink-0 text-[11px] text-[var(--cream-mute)]">{extMsg}</div>
      )}

      <div className="flex-1 min-h-0 flex rounded-xl border overflow-hidden" style={{ borderColor: "var(--line-soft)" }}>
        {leftOpen && (
          <aside
            className="shrink-0 w-[240px] border-r flex flex-col min-h-0"
            style={{ borderColor: "var(--panel-border)", background: "var(--bg-mid)" }}
          >
            <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3 sidebar-scroll">
              <div className="space-y-2">
                <Stat label="Active jobs" value={String(jobCount)} accent="#22d3ee" compact />
                <Stat label="Herdr agents" value={String(agentPanes.length)} accent="#d4a574" compact />
                <Stat label="Panes open" value={String(panes.length)} accent="#a855f7" compact />
                <Stat label="Workspaces" value={String(workspaces.length)} accent="#86efac" compact />
              </div>

              {err && (
                <div className="rounded-lg border p-2.5 flex items-start gap-2 text-[11px]" style={{ borderColor: "rgba(251,113,133,.35)", color: "#fda4af" }}>
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                  <span>{err}</span>
                </div>
              )}
              {runtimeProjectionError && (
                <div className="rounded-lg border p-2.5 flex items-start gap-2 text-[11px]" style={{ borderColor: "rgba(251,191,36,.35)", color: "#fde68a" }}>
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                  <span>Canonical runtime projection: {runtimeProjectionError}</span>
                </div>
              )}
              {loaded && status && !status.running && (
                <StatusHint status={status} compact />
              )}

              {runtimeAttempts.length > 0 && (
                <section className="space-y-1.5">
                  <h2 className="text-[10px] font-semibold uppercase tracking-[.16em]" style={{ color: "var(--cream-mute)" }}>
                    Attempts
                  </h2>
                  {runtimeAttempts.map((attempt) => (
                    <div
                      key={attempt.attempt_id}
                      className="rounded-lg border px-2.5 py-2 text-[11.5px]"
                      style={{ borderColor: "var(--line-soft)" }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium" style={{ color: "var(--cream)" }} title={attempt.builder_id || attempt.attempt_id}>
                          {attempt.builder_id || attempt.attempt_id}
                        </span>
                        <span className="shrink-0 text-[9px] uppercase tracking-wide" style={{ color: attempt.status === "failed" ? "#fda4af" : "var(--cream-mute)" }}>
                          {attempt.status}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate text-[10px]" style={{ color: "var(--cream-mute)" }} title={attempt.task_id}>
                        {attempt.task_id}
                      </div>
                    </div>
                  ))}
                </section>
              )}

              {agentPanes.length > 0 && (
                <section className="space-y-1.5">
                  <h2 className="text-[10px] font-semibold uppercase tracking-[.16em]" style={{ color: "var(--cream-mute)" }}>
                    Agents
                  </h2>
                  {agentPanes.map((pane, i) => (
                    <div
                      key={pane.pane_id ?? `agent-${i}`}
                      className="rounded-lg border px-2.5 py-2 text-[11.5px]"
                      style={{ borderColor: "var(--line-soft)" }}
                    >
                      <div className="truncate font-medium" style={{ color: "var(--cream)" }} title={pane.agent}>
                        {pane.agent}
                      </div>
                      {(pane.terminal_title_stripped || pane.terminal_title || pane.cwd) && (
                        <div className="mt-0.5 truncate text-[10px]" style={{ color: "var(--cream-mute)" }} title={pane.cwd ?? pane.terminal_title}>
                          {pane.terminal_title_stripped || pane.terminal_title || pane.cwd}
                        </div>
                      )}
                    </div>
                  ))}
                </section>
              )}

              {workspaces.length > 0 && (
                <section className="space-y-1.5">
                  <h2 className="text-[10px] font-semibold uppercase tracking-[.16em]" style={{ color: "var(--cream-mute)" }}>
                    Workspaces
                  </h2>
                  {workspaces.map((ws) => (
                    <div
                      key={ws.workspace_id}
                      className="rounded-lg border px-2.5 py-2 text-[11.5px] truncate"
                      style={{ borderColor: "var(--line-soft)", color: "var(--cream)" }}
                      title={ws.workspace_id}
                    >
                      {ws.label || ws.workspace_id}
                    </div>
                  ))}
                </section>
              )}
            </div>
          </aside>
        )}

        <div className="flex-1 min-w-0 min-h-0 overflow-y-auto" style={{ background: "var(--bg-deep)" }}>
          <div className="h-full p-6">
            {jobBoard}
          </div>
        </div>
      </div>

      {debugShellOpen && (
        <DebugShell open={debugShellOpen} onClose={() => setDebugShellOpen(false)} />
      )}
    </div>
  );
}

function JobBoard({
  compact,
  attachedAttempts,
  doneAttempts,
  busyPanes,
  idlePanes,
  onOpenDebug,
}: {
  compact?: boolean;
  attachedAttempts: RuntimeAttempt[];
  doneAttempts: RuntimeAttempt[];
  busyPanes: Pane[];
  idlePanes: Pane[];
  onOpenDebug: () => void;
}) {
  const attachedCount = attachedAttempts.length + busyPanes.length;
  const idleCount = idlePanes.length;
  const doneCount = doneAttempts.length;
  const empty = attachedCount === 0 && idleCount === 0 && doneCount === 0;

  // Prefer Attached (like Active on builders); fall over only when that bucket is empty.
  const [openSection, setOpenSection] = useState<StatusSectionId>("attached");

  useEffect(() => {
    setOpenSection((cur) => {
      const curEmpty =
        (cur === "attached" && attachedCount === 0)
        || (cur === "idle" && idleCount === 0)
        || (cur === "done" && doneCount === 0);
      if (!curEmpty) return cur;
      if (attachedCount > 0) return "attached";
      if (idleCount > 0) return "idle";
      if (doneCount > 0) return "done";
      return "attached";
    });
  }, [attachedCount, idleCount, doneCount]);

  return (
    <div className={compact ? "space-y-3" : "space-y-4"}>
      {empty && (
        <div className={`panel ${compact ? "p-4" : "p-5"} space-y-2`}>
          <div className="text-[13px] font-medium" style={{ color: "var(--cream)" }}>
            No running jobs
          </div>
          <div className="text-[12px] leading-relaxed" style={{ color: "var(--fg-dim)" }}>
            Groups below update as attempts attach or Herdr panes change. Open Debug Shell only for a manual terminal.
          </div>
          <button
            type="button"
            onClick={onOpenDebug}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-mid)] px-3 text-[12px] font-medium text-[var(--cream-mute)] transition hover:text-[var(--cream)]"
          >
            <Code size={13} /> Debug Shell
          </button>
        </div>
      )}

      <StatusSection
        id="attached"
        title="Attached"
        hint="Pending / attached attempts and busy panes"
        count={attachedCount}
        open={openSection === "attached"}
        onToggle={() => setOpenSection("attached")}
      >
        {attachedCount === 0 ? (
          <div className="text-[12px] text-[var(--fg-dimmer)] px-1 py-2">Nothing attached right now.</div>
        ) : (
          <div className={compact ? "space-y-2" : "space-y-3"}>
            {attachedAttempts.map((attempt) => (
              <AttemptCard key={attempt.attempt_id} attempt={attempt} compact={compact} />
            ))}
            {busyPanes.map((pane, i) => (
              <PaneCard key={pane.pane_id ?? `busy-${i}`} pane={pane} compact={compact} />
            ))}
          </div>
        )}
      </StatusSection>

      <StatusSection
        id="idle"
        title="Idle"
        hint="Herdr panes waiting"
        count={idleCount}
        open={openSection === "idle"}
        onToggle={() => setOpenSection("idle")}
      >
        {idleCount === 0 ? (
          <div className="text-[12px] text-[var(--fg-dimmer)] px-1 py-2">No idle panes.</div>
        ) : (
          <div className={compact ? "space-y-2" : "space-y-3"}>
            {idlePanes.map((pane, i) => (
              <PaneCard key={pane.pane_id ?? `idle-${i}`} pane={pane} compact={compact} />
            ))}
          </div>
        )}
      </StatusSection>

      <StatusSection
        id="done"
        title="Done"
        hint="Completed, failed, or cancelled attempts"
        count={doneCount}
        open={openSection === "done"}
        onToggle={() => setOpenSection("done")}
      >
        {doneCount === 0 ? (
          <div className="text-[12px] text-[var(--fg-dimmer)] px-1 py-2">No settled attempts yet.</div>
        ) : (
          <div className={compact ? "space-y-2" : "space-y-3"}>
            {doneAttempts.map((attempt) => (
              <AttemptCard key={attempt.attempt_id} attempt={attempt} compact={compact} />
            ))}
          </div>
        )}
      </StatusSection>
    </div>
  );
}

function StatusSection({
  id,
  title,
  hint,
  count,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  hint: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`code-space-section-${id}`}
        className="w-full flex items-center gap-2 px-1 py-1.5 text-left transition hover:opacity-90"
      >
        <ChevronDown
          size={14}
          className="shrink-0 transition-transform"
          style={{
            color: open ? "var(--gold)" : "var(--cream-mute)",
            transform: open ? "rotate(0deg)" : "rotate(-90deg)",
          }}
        />
        <span
          className="text-[11px] font-semibold uppercase tracking-[0.16em]"
          style={{ color: open ? "var(--gold)" : "var(--cream-mute)" }}
        >
          {title}
        </span>
        <span className="text-[11px] text-[var(--fg-dimmer)]">· {count}</span>
        <span className="text-[11px] text-[var(--fg-dimmer)] truncate hidden sm:inline">— {hint}</span>
      </button>
      {open && (
        <div id={`code-space-section-${id}`}>
          {children}
        </div>
      )}
    </section>
  );
}

function AttemptCard({ attempt, compact }: { attempt: RuntimeAttempt; compact?: boolean }) {
  const summary = attempt.terminal_summary?.trim();
  return (
    <div className={`panel space-y-2 ${compact ? "p-3" : "p-4"}`}>
      <div className="flex items-center justify-between gap-3">
        <span
          className={`font-semibold truncate ${compact ? "text-[13px]" : "text-[15px]"}`}
          style={{ color: "var(--cream)" }}
          title={attempt.builder_id}
        >
          {attempt.builder_id}
        </span>
        <StatusBadge status={attempt.status} />
      </div>
      {summary ? (
        <div className={`${compact ? "text-[12px]" : "text-[13px]"} leading-relaxed`} style={{ color: "var(--cream-mute)" }}>
          {summary}
        </div>
      ) : (
        <div className={`${compact ? "text-[12px]" : "text-[13px]"}`} style={{ color: "var(--fg-dim)" }}>
          No terminal summary yet.
        </div>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]" style={{ color: "var(--fg-dim)" }}>
        <span title={attempt.task_id}><span className="text-[var(--fg-dimmer)]">Task:</span> {attempt.task_id}</span>
        <span><span className="text-[var(--fg-dimmer)]">Pane:</span> {attempt.pane_id}</span>
        {isRealTimestamp(attempt.last_heartbeat_at) && (
          <span>
            <span className="text-[var(--fg-dimmer)]">Heartbeat:</span>{" "}
            {new Date(attempt.last_heartbeat_at).toLocaleTimeString()}
          </span>
        )}
      </div>
    </div>
  );
}

function PaneCard({ pane, compact }: { pane: Pane; compact?: boolean }) {
  const title = pane.terminal_title_stripped || pane.terminal_title || pane.agent || "Pane";
  const statusLabel = paneStatus(pane);
  return (
    <div className={`panel space-y-2 ${compact ? "p-3" : "p-4"}`}>
      <div className="flex items-center justify-between gap-3">
        <span
          className={`font-semibold truncate ${compact ? "text-[13px]" : "text-[15px]"}`}
          style={{ color: "var(--cream)" }}
          title={title}
        >
          {title}
        </span>
        <span
          className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide"
          style={{
            borderColor: statusLabel === "idle" ? "rgba(161,161,170,.35)" : "rgba(134,239,172,.35)",
            background: statusLabel === "idle" ? "rgba(161,161,170,.10)" : "rgba(134,239,172,.10)",
            color: statusLabel === "idle" ? "#a1a1aa" : "#86efac",
          }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: "currentColor" }} />
          {statusLabel}
        </span>
      </div>
      <div className={`${compact ? "text-[12px]" : "text-[13px]"}`} style={{ color: "var(--cream-mute)" }}>
        {pane.agent ? `${pane.agent} on Herdr` : "Herdr pane"}
        {pane.cwd ? ` · ${pane.cwd}` : ""}
      </div>
      {pane.pane_id && (
        <div className="text-[11px]" style={{ color: "var(--fg-dim)" }}>
          <span className="text-[var(--fg-dimmer)]">Pane:</span> {pane.pane_id}
        </div>
      )}
    </div>
  );
}

function StatusHint({ status, compact = false }: { status: Status; compact?: boolean }) {
  return (
    <div className={`panel flex items-start gap-2.5 ${compact ? "p-2.5" : "p-4"}`}>
      <AlertTriangle size={compact ? 14 : 16} className="mt-0.5 shrink-0 text-amber-300" />
      <div className={`text-amber-200 space-y-1.5 ${compact ? "text-[11px]" : "text-[12px]"}`}>
        <div>{status.error}</div>
        {status.installed ? (
          <div className="text-[var(--fg-dim)]">
            Start: <code className="mono px-1 rounded bg-[rgba(255,255,255,0.05)]">herdr</code>
          </div>
        ) : (
          <div className="text-[var(--fg-dim)]">
            Install Herdr from <span className="mono">github.com/ogulcancelik/herdr</span>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, accent, compact = false }: { label: string; value: string; accent: string; compact?: boolean }) {
  return (
    <div className="aura-border aura-border--soft rounded-[10px]">
      <div className={`panel relative overflow-hidden ${compact ? "p-2.5" : "p-4"}`}>
        <div className="absolute -right-12 -top-12 w-32 h-32 rounded-full blur-3xl opacity-30" style={{ background: accent }} />
        <div className="relative text-[9px] uppercase tracking-widest text-[var(--fg-dimmer)]">{label}</div>
        <div className={`relative metric mt-0.5 ${compact ? "text-xl" : "text-3xl"}`} style={{ color: accent }}>{value}</div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: RuntimeAttempt["status"] }) {
  const colors = {
    pending: { border: "rgba(212,165,116,.35)", bg: "rgba(212,165,116,.10)", text: "#d4a574" },
    attached: { border: "rgba(134,239,172,.35)", bg: "rgba(134,239,172,.10)", text: "#86efac" },
    completed: { border: "rgba(134,239,172,.35)", bg: "rgba(134,239,172,.10)", text: "#86efac" },
    failed: { border: "rgba(251,113,133,.35)", bg: "rgba(251,113,133,.10)", text: "#fb7185" },
    cancelled: { border: "rgba(161,161,170,.35)", bg: "rgba(161,161,170,.10)", text: "#a1a1aa" },
  };
  const c = colors[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide"
      style={{ borderColor: c.border, background: c.bg, color: c.text }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.text }} />
      {status}
    </span>
  );
}
