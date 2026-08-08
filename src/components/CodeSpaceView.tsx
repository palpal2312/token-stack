"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, AlertTriangle, PanelLeft, PanelLeftClose, SquareTerminal, ExternalLink, Code } from "lucide-react";
import HerdrTerminal from "./HerdrTerminal";
import DebugShell from "./DebugShell";
import HeaderStatPills from "./HeaderStatPills";
import PageHeaderIcon from "./PageHeaderIcon";
import { apiFetch } from "@/lib/apiFetch";

// The Code Space is a terminal onto Herdr with a thin status readout on the
// left rail. Herdr owns the panes and the processes; this page attaches to
// the same default session and aggregates its headline numbers. Closing this
// tab does not stop anything — that is the point of using a real multiplexer.

interface Pane { pane_id?: string; agent?: string; cwd?: string; terminal_title?: string }
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
  const [openingExt, setOpeningExt] = useState(false);
  const [extMsg, setExtMsg] = useState<string | null>(null);
  const [debugShellOpen, setDebugShellOpen] = useState(false);
  // Status rail starts closed so the terminal owns the page; user can expand it.
  const [leftOpen, setLeftOpen] = useState(false);
  const [leftReady, setLeftReady] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_PANEL);
      if (raw === "1") setLeftOpen(true);
      // missing or "0" → stay closed (default)
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
      setExtMsg(j.via === "windows-terminal" ? "Opened Herdr in Windows Terminal." : "Opened Herdr in a system terminal.");
    } catch (e) {
      setExtMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setOpeningExt(false);
    }
  }, []);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      let j: Record<string, unknown>;
      try { j = await (await fetch("/api/herdr/snapshot", { cache: "no-store" })).json(); }
      catch { j = { error: "The dashboard did not answer." }; }
      setStatus((j.status as Status) ?? null);
      const snap = j.snapshot as { panes?: Pane[]; workspaces?: Workspace[] } | null;
      setPanes(snap?.panes ?? []);
      setWorkspaces(snap?.workspaces ?? []);
      setRuntimeAttempts((j.runtimeAttempts as RuntimeAttempt[]) ?? []);
      setRuntimeProjectionEnabled(j.runtimeProjectionEnabled === true);
      setRuntimeProjectionError((j.runtimeProjectionError as string) ?? null);
      setErr((j.snapshotError as string) ?? null);
      setLoaded(true);
    } finally { setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    pollRef.current = setInterval(load, 10_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [load]);

  const agentPanes = panes.filter((p) => p.agent);
  const activeRuntimeAttempts = runtimeAttempts.filter((attempt) => attempt.status === "attached");
  const showProjectionOnly = runtimeProjectionEnabled && activeRuntimeAttempts.length > 0;

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
        <div className="grid grid-cols-3 gap-3">
          <Stat
            label={runtimeProjectionEnabled ? "Active attempts" : "Running agents"}
            value={String(runtimeProjectionEnabled ? activeRuntimeAttempts.length : agentPanes.length)}
            accent="#22d3ee"
            compact
          />
          <Stat label="Panes open" value={String(panes.length)} accent="#a855f7" compact />
          <Stat label="Workspaces" value={String(workspaces.length)} accent="#86efac" compact />
        </div>
        {showProjectionOnly ? (
          <div className="panel p-4 space-y-3">
            <div className="text-[11px] uppercase tracking-widest text-[var(--fg-dimmer)]">
              Canonical Runtime Projection
            </div>
            {activeRuntimeAttempts.map((attempt) => (
              <div key={attempt.attempt_id} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-medium truncate" style={{ color: "var(--cream)" }}>{attempt.builder_id}</span>
                  <StatusBadge status={attempt.status} />
                </div>
                <div className="text-[10px] truncate" style={{ color: "var(--fg-dim)" }} title={attempt.task_id}>
                  Task: {attempt.task_id}
                </div>
                <div className="text-[10px]" style={{ color: "var(--fg-dim)" }}>
                  Pane: {attempt.pane_id}
                </div>
                {attempt.last_heartbeat_at && (
                  <div className="text-[10px]" style={{ color: "var(--fg-dim)" }}>
                    Last heartbeat: {new Date(attempt.last_heartbeat_at).toLocaleTimeString()}
                  </div>
                )}
                {attempt.terminal_summary && (
                  <div className="text-[10px] truncate" style={{ color: "var(--fg-dim)" }} title={attempt.terminal_summary}>
                    {attempt.terminal_summary}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <HerdrTerminal compact />
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
                ...(runtimeProjectionEnabled ? [{
                  label: `${activeRuntimeAttempts.length} active attempts`,
                  tone: activeRuntimeAttempts.length ? "ok" as const : "neutral" as const,
                }] : []),
                { label: `${agentPanes.length} agents`, tone: agentPanes.length ? "ok" : "neutral" },
                { label: `${panes.length} panes`, tone: panes.length ? "accent" : "neutral" },
                { label: `${workspaces.length} workspaces`, tone: workspaces.length ? "accent" : "neutral" },
              ]}
            />
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => void openExternal()}
            disabled={openingExt || (loaded && status !== null && !status.installed)}
            title="Open Herdr in Windows Terminal (recommended for heavy TUI)"
            className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-mid)] px-3 text-[12px] font-medium text-[var(--cream-mute)] transition hover:text-[var(--cream)] disabled:opacity-40"
          >
            <ExternalLink size={13} /> {openingExt ? "Opening…" : "Open Terminal"}
          </button>
          <button
            type="button"
            onClick={() => setDebugShellOpen(true)}
            title="Open debug shell (bypasses projection authority)"
            className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-mid)] px-3 text-[12px] font-medium text-[var(--cream-mute)] transition hover:text-[var(--cream)]"
          >
            <Code size={13} /> Debug Shell
          </button>
          <button
            onClick={load}
            disabled={refreshing}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-mid)] px-3 text-[12px] font-medium text-[var(--cream-mute)] transition hover:text-[var(--cream)]"
          >
            <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} /> Refresh
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
                {runtimeProjectionEnabled && (
                  <Stat label="Canonical active" value={String(activeRuntimeAttempts.length)} accent="#22d3ee" compact />
                )}
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

              {runtimeProjectionEnabled && runtimeAttempts.length > 0 && (
                <section className="space-y-1.5">
                  <h2 className="text-[10px] font-semibold uppercase tracking-[.16em]" style={{ color: "var(--cream-mute)" }}>
                    Canonical attempts
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
                      {(pane.terminal_title || pane.cwd) && (
                        <div className="mt-0.5 truncate text-[10px]" style={{ color: "var(--cream-mute)" }} title={pane.cwd ?? pane.terminal_title}>
                          {pane.terminal_title || pane.cwd}
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

        <div className="flex-1 min-w-0 min-h-0">
          {showProjectionOnly ? (
            <div className="h-full overflow-y-auto p-6 space-y-4" style={{ background: "var(--bg-deep)" }}>
              <div className="text-[13px] uppercase tracking-widest text-[var(--fg-dimmer)]">
                Canonical Runtime Projection
              </div>
              {activeRuntimeAttempts.map((attempt) => (
                <div key={attempt.attempt_id} className="panel p-4 space-y-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[15px] font-semibold truncate" style={{ color: "var(--cream)" }} title={attempt.builder_id}>
                      {attempt.builder_id}
                    </span>
                    <StatusBadge status={attempt.status} />
                  </div>
                  <div className="text-[11.5px] truncate" style={{ color: "var(--fg-dim)" }} title={attempt.task_id}>
                    <span className="text-[var(--fg-dimmer)]">Task:</span> {attempt.task_id}
                  </div>
                  <div className="text-[11.5px]" style={{ color: "var(--fg-dim)" }}>
                    <span className="text-[var(--fg-dimmer)]">Pane:</span> {attempt.pane_id}
                  </div>
                  {attempt.last_heartbeat_at && (
                    <div className="text-[11.5px]" style={{ color: "var(--fg-dim)" }}>
                      <span className="text-[var(--fg-dimmer)]">Last heartbeat:</span>{" "}
                      {new Date(attempt.last_heartbeat_at).toLocaleTimeString()}
                    </div>
                  )}
                  {attempt.terminal_summary && (
                    <div className="text-[11.5px] truncate" style={{ color: "var(--fg-dim)" }} title={attempt.terminal_summary}>
                      <span className="text-[var(--fg-dimmer)]">Terminal:</span> {attempt.terminal_summary}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <HerdrTerminal fill />
          )}
        </div>
      </div>

      {debugShellOpen && (
        <DebugShell open={debugShellOpen} onClose={() => setDebugShellOpen(false)} />
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
