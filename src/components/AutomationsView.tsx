"use client";

// Automations + the approval Inbox.
//
// Automations are Sen runs on a schedule: a prompt, a brain (a Router or
// a Builder profile), and either an interval or a daily wall-clock time. The
// scheduler lives inside this dashboard (v1, on purpose — the page says so):
// it ticks while the server is up, catches a missed window up ONCE when it
// comes back, and never runs an automation twice at the same time.
//
// The Inbox is the other half. A router-brained automation with approvals on
// (the default) parks any write/external tool call here instead of running it
// unattended. Approve executes that exact call once; reject hands the model
// the no and lets it finish without the tool. Asks die after 48h.

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus, X, AlertTriangle, Trash2, Pencil, Play, Inbox, History,
  FileText, CalendarClock, Check, Ban, Loader2, RefreshCw,
} from "lucide-react";
import { usePollWhileVisible } from "@/lib/usePollWhileVisible";
import HeaderStatPills from "./HeaderStatPills";
import PageHeaderIcon from "./PageHeaderIcon";
import {
  CachePresets,
  ClientCacheKeys,
  cachedFetchJson,
  invalidateCache,
  readCache,
} from "@/lib/client-data-cache";

interface Automation {
  id: string; name: string;
  intervalMin?: number; timeOfDay?: string;
  // "firstmate" is the Sen brain — legacy compatibility key (persisted discriminator).
  brainRef: { kind: "router"; routerId: string } | { kind: "builder"; builderId: string } | { kind: "firstmate"; routerId: string };
  prompt: string; requiresApproval: boolean; enabled: boolean;
  lastRunAt?: string; nextRunAt: string;
  runsToday: number; runsTodayDate: string;
  lastSkip?: { at: string; reason: string };
  createdAt: string;
  /** Set while a run is in flight (in-process marker + state file's last step). */
  inFlight?: { runId: string; sinceMs: number; lastStep: string | null } | null;
}

interface ApprovalItem {
  id: string; runId: string; source: string; toolCallId: string;
  tool: string; summary: string;
  createdAt: string; expiresAt: string;
  status: "pending" | "approved" | "rejected" | "expired";
  decidedAt?: string;
  actionHash: string; evidenceHash: string;
  redactionClass: "public" | "local-sensitive" | "secret";
  redactedPaths: string[];
  truncated: boolean;
}

interface AutomationRun {
  id: string; automationId: string; trigger: string; startedAt: string;
  status: string;
  output:
    | { kind: "runtime"; runDir: string; finalText: string }
    | { kind: "builder"; text: string; error: string | null };
  durationMs: number;
  assetVersion?: string;
}

/** The runs endpoint's live entry: an in-flight run's state, read from its
 * state file — there is no run record until the run settles. */
interface LiveRun {
  runId: string; sinceMs: number; status: "running"; lastStep: string | null;
  steps: { kind: string; at: string; text?: string; name?: string }[];
}

function stepTitle(s: { kind: string; text?: string; name?: string }): string {
  return s.text ?? (s.kind === "tool" && s.name ? `tool: ${s.name}` : s.kind);
}

interface RefOption { id: string; name: string; hint: string }

async function readJson(r: Response): Promise<Record<string, unknown>> {
  try { return await r.json(); }
  catch { return { error: `The server returned ${r.status} with no explanation.` }; }
}

function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const diff = t - Date.now();
  const abs = Math.abs(diff);
  const unit = abs < 60_000 ? [Math.round(abs / 1000), "s"]
    : abs < 3_600_000 ? [Math.round(abs / 60_000), "m"]
    : abs < 86_400_000 ? [Math.round(abs / 3_600_000), "h"]
    : [Math.round(abs / 86_400_000), "d"];
  return diff >= 0 ? `in ${unit[0]}${unit[1]}` : `${unit[0]}${unit[1]} ago`;
}

function scheduleText(a: Automation): string {
  if (a.intervalMin) return a.intervalMin % 60 === 0 ? `every ${a.intervalMin / 60}h` : `every ${a.intervalMin}m`;
  return `daily at ${a.timeOfDay}`;
}

const STATUS_COLOR: Record<string, string> = {
  done: "#86efac", blocked: "#fbbf24", failed: "#fb7185", "max-turns": "#fbbf24",
};

export default function AutomationsView() {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [cap, setCap] = useState(6);
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [pending, setPending] = useState(0);
  const [routers, setRouters] = useState<RefOption[]>([]);
  const [builders, setBuilders] = useState<RefOption[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<Automation | "new" | null>(null);
  const [runsFor, setRunsFor] = useState<Automation | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [refreshing, setRefreshing] = useState(false);

  async function load(opts?: { force?: boolean }) {
    const autoKey = ClientCacheKeys.automations;
    const apprKey = ClientCacheKeys.approvals;
    const policy = CachePresets.semi;

    if (!opts?.force) {
      const autoHit = readCache<Record<string, unknown>>(autoKey, policy);
      const apprHit = readCache<Record<string, unknown>>(apprKey, CachePresets.live);
      if (autoHit?.usable && apprHit?.usable) {
        setAutomations((autoHit.data.automations as Automation[]) ?? []);
        setCap((autoHit.data.cap as number) ?? 6);
        setApprovals((apprHit.data.approvals as ApprovalItem[]) ?? []);
        setPending((apprHit.data.pending as number) ?? 0);
        setErr((autoHit.data.error as string) ?? (apprHit.data.error as string) ?? null);
        setLoaded(true);
        if (autoHit.fresh && apprHit.fresh) return;
      }
    } else {
      invalidateCache(autoKey);
      invalidateCache(apprKey);
    }

    setRefreshing(true);
    try {
      const [ajRes, pjRes] = await Promise.all([
        cachedFetchJson(
          autoKey,
          async () => readJson(await fetch("/api/automations", { cache: "no-store" })),
          { ...policy, force: true },
        ),
        cachedFetchJson(
          apprKey,
          async () => readJson(await fetch("/api/approvals", { cache: "no-store" })),
          { ...CachePresets.live, force: true },
        ),
      ]);
      const aj = ajRes.data;
      const pj = pjRes.data;
      setAutomations((aj.automations as Automation[]) ?? []);
      setCap((aj.cap as number) ?? 6);
      setApprovals((pj.approvals as ApprovalItem[]) ?? []);
      setPending((pj.pending as number) ?? 0);
      setErr((aj.error as string) ?? (pj.error as string) ?? null);
    } catch (e) {
      setErr(`Could not reach the dashboard's own API: ${String((e as Error)?.message ?? e)}`);
    } finally {
      setLoaded(true);
      setRefreshing(false);
    }
  }
  useEffect(() => { void load(); }, []);   // first paint — after that the page stays quiet…
  // …unless a run is in flight: then (and only then) poll every 5s until the
  // last one settles. The response that shows no in-flight run is the last
  // fetch; the marker it just cleared was painted by it. A run started from
  // this page counts as in flight the moment its button is clicked (busy),
  // which is how an idle page ever learns a run began — there is no idle poll.
  const anyInFlight = automations.some((a) => a.inFlight || busy[`run:${a.id}`]);
  usePollWhileVisible(() => { void load({ force: true }); }, 5000, [], anyInFlight);

  // Brain pickers: the existing registries, read once per modal open.
  useEffect(() => {
    if (!editing) return;
    void (async () => {
      const [rjRes, bjRes] = await Promise.all([
        cachedFetchJson(
          ClientCacheKeys.routers,
          async () => readJson(await fetch("/api/routers", { cache: "no-store" })),
          CachePresets.static,
        ),
        cachedFetchJson(
          ClientCacheKeys.builders,
          async () => readJson(await fetch("/api/builders", { cache: "no-store" })),
          CachePresets.static,
        ),
      ]);
      const rj = rjRes.data;
      const bj = bjRes.data;
      setRouters(((rj.routers as { id: string; name: string; defaultModel: string | null }[]) ?? [])
        .map((r) => ({ id: r.id, name: r.name, hint: r.defaultModel ?? "no default model" })));
      setBuilders(((bj.builders as { id: string; name: string; cli: string }[]) ?? [])
        .map((b) => ({ id: b.id, name: b.name, hint: b.cli })));
    })();
  }, [editing]);

  async function decide(item: ApprovalItem, decision: "approve" | "reject") {
    setBusy((b) => ({ ...b, [item.id]: true }));
    const j = await readJson(await fetch(`/api/approvals/${item.id}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision }),
    }));
    if (j.error) setErr(String(j.error));
    else setErr(null);
    setBusy((b) => ({ ...b, [item.id]: false }));
    await load({ force: true });
  }

  async function runNow(a: Automation) {
    setBusy((b) => ({ ...b, [`run:${a.id}`]: true }));
    const j = await readJson(await fetch(`/api/automations/${a.id}/run`, { method: "POST" }));
    if (j.error) setErr(String(j.error));
    else setErr(null);
    setBusy((b) => ({ ...b, [`run:${a.id}`]: false }));
    await load({ force: true });
  }

  async function toggle(a: Automation) {
    await fetch(`/api/automations/${a.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: !a.enabled }),
    });
    await load({ force: true });
  }

  async function remove(a: Automation) {
    if (!confirm(`Delete "${a.name}"?\n\nIts run history and transcripts stay on disk.`)) return;
    const j = await readJson(await fetch(`/api/automations/${a.id}`, { method: "DELETE" }));
    if (j.error) setErr(String(j.error)); else { setErr(null); await load({ force: true }); }
  }

  const brainLabel = useMemo(() => {
    const map: Record<string, string> = {};
    for (const r of routers) map[`router:${r.id}`] = r.name;
    for (const b of builders) map[`builder:${b.id}`] = b.name;
    return (a: Automation) => {
      const ref = a.brainRef;
      if (ref.kind === "builder") return map[`builder:${ref.builderId}`] ?? ref.builderId;
      const label = map[`router:${ref.routerId}`] ?? ref.routerId;
      return ref.kind === "firstmate" ? `Sen · ${label}` : label;
    };
  }, [routers, builders]);

  const pendingItems = approvals.filter((x) => x.status === "pending");
  const staleItems = approvals.filter((x) => x.status !== "pending").slice(0, 5);
  const enabledCount = automations.filter((a) => a.enabled).length;

  return (
    <div className="flex min-h-0 flex-col h-full px-4 md:px-6 py-3">
      <header className="flex shrink-0 flex-wrap items-center gap-3 mb-3">
          <PageHeaderIcon gradient="linear-gradient(135deg,#fbbf24,#ea580c)">
          <CalendarClock size={18} />
        </PageHeaderIcon>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-[var(--cream)]">
            Automations
            {pending > 0 && (
              <span
                className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium"
                style={{
                  borderColor: "rgba(251,191,36,.45)",
                  color: "#fbbf24",
                  background: "rgba(251,191,36,.10)",
                }}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#fbbf24" }} />
                {pending} pending
              </span>
            )}
            <HeaderStatPills
              stats={[
                { label: `${automations.length} schedules`, tone: automations.length ? "accent" : "neutral" },
                { label: `${enabledCount} enabled`, tone: enabledCount ? "ok" : "neutral" },
                { label: `${pending} awaiting`, tone: pending ? "warn" : "neutral" },
              ]}
            />
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load({ force: true })}
          disabled={refreshing}
          className="ml-auto shrink-0 inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-mid)] px-3 text-[12px] font-medium text-[var(--cream-mute)] transition hover:text-[var(--cream)]"
        >
          <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} /> Refresh
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-6">
      {err && (
        <div className="panel p-3 flex items-start gap-2.5">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-rose-300" />
          <div className="text-[12px] text-rose-300">{err}</div>
        </div>
      )}

      {/* ---------------------------------------------------------- Inbox */}
      <section className="panel p-4 space-y-3">
        <div className="flex items-center gap-2.5">
          <Inbox size={16} style={{ color: "var(--gold)" }} />
          <h2 className="text-[15px] font-medium tracking-tight">Approval Inbox</h2>
          {pending > 0 && (
            <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                  style={{ background: "rgba(251,191,36,0.16)", color: "#fbbf24" }}>
              {pending} pending
            </span>
          )}
        </div>
        <p className="text-[11.5px] text-[var(--fg-dim)]">
          A parked tool call never runs on its own. Approve executes that exact call once; reject lets the run
          finish without it. Asks expire 48h after they are made.
        </p>

        {pendingItems.length === 0 && (
          <div className="text-[12px] text-[var(--cream-mute)] py-2">Nothing waiting. Unattended runs stay inside their jail.</div>
        )}

        <div className="space-y-2">
          {pendingItems.map((item) => (
            <div key={item.id} className="rounded-lg border border-[var(--line-soft)] p-3 space-y-2"
                 style={{ background: "rgba(251,191,36,0.05)" }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[12.5px]">{item.summary}</div>
                  <div className="text-[10.5px] text-[var(--cream-mute)] mt-1 mono">
                    {item.tool} · asked {relTime(item.createdAt)} · expires {relTime(item.expiresAt)}
                  </div>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <button
                    onClick={() => decide(item, "approve")}
                    disabled={busy[item.id]}
                    className="flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-md transition hover:brightness-125 disabled:opacity-50"
                    style={{ background: "rgba(134,239,172,0.14)", color: "#86efac" }}>
                    {busy[item.id] ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Approve
                  </button>
                  <button
                    onClick={() => decide(item, "reject")}
                    disabled={busy[item.id]}
                    className="flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-md transition hover:brightness-125 disabled:opacity-50"
                    style={{ background: "rgba(251,113,133,0.12)", color: "#fb7185" }}>
                    <Ban size={12} /> Reject
                  </button>
                </div>
              </div>
              <div className="text-[10.5px] mono text-[var(--fg-dim)] rounded-md p-2 space-y-1"
                   style={{ background: "rgba(0,0,0,0.25)" }}>
                <div>action {item.actionHash.slice(0, 16)} · evidence {item.evidenceHash.slice(0, 16)}</div>
                <div>redaction {item.redactionClass}{item.truncated ? " · truncated" : ""}</div>
              </div>
            </div>
          ))}

          {staleItems.map((item) => (
            <div key={item.id} className="rounded-lg border border-[var(--line-soft)] p-3 opacity-45">
              <div className="text-[12px]">{item.summary}</div>
              <div className="text-[10.5px] text-[var(--cream-mute)] mt-1">
                {item.status} {item.decidedAt ? relTime(item.decidedAt) : ""}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------ automations */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-medium tracking-tight flex items-center gap-2">
            <CalendarClock size={16} style={{ color: "var(--gold)" }} /> Schedules
          </h2>
          <button
            onClick={() => setEditing("new")}
            className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-lg transition hover:brightness-110"
            style={{ background: "rgba(212,165,116,0.16)", color: "var(--gold)" }}>
            <Plus size={13} /> New automation
          </button>
        </div>

        {loaded && automations.length === 0 && (
          <div className="panel p-5 text-[12.5px] text-[var(--cream-mute)]">
            No automations yet. One prompt + one brain + one schedule — the run transcript lands here after every fire.
          </div>
        )}

        <div className="grid gap-3">
          {automations.map((a) => (
            <div key={a.id} className={`panel aura-border aura-border--soft p-4 flex flex-col gap-3 ${a.inFlight ? "aura-border--live" : ""}`} style={{ opacity: a.enabled ? 1 : 0.55 }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[14px] font-medium">{a.name}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full mono"
                          style={{ background: "rgba(125,211,252,0.12)", color: "#7dd3fc" }}>
                      {a.brainRef.kind} · {brainLabel(a)}
                    </span>
                    {!a.enabled && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full"
                            style={{ background: "rgba(148,163,184,0.14)", color: "#94a3b8" }}>paused</span>
                    )}
                  </div>
                  <div className="text-[11.5px] text-[var(--fg-dim)] mt-1 truncate max-w-xl" title={a.prompt}>
                    {a.prompt}
                  </div>
                  <div className="text-[10.5px] text-[var(--cream-mute)] mt-1.5 mono">
                    {scheduleText(a)} · next {relTime(a.nextRunAt)}
                    {a.lastRunAt && <> · last ran {relTime(a.lastRunAt)}</>}
                  </div>
                  {a.inFlight && (
                    <div className="flex items-center gap-2 mt-1.5 text-[11px]" style={{ color: "#7dd3fc" }}
                         title="Live from the run's state file. A dashboard restart loses this marker — the run itself keeps going and settles into its record regardless.">
                      <span className="relative flex h-2 w-2 shrink-0">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60" style={{ background: "#7dd3fc" }} />
                        <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: "#7dd3fc" }} />
                      </span>
                      <span className="truncate max-w-xl">
                        Running now · since {relTime(new Date(a.inFlight.sinceMs).toISOString())}
                        {a.inFlight.lastStep ? ` · ${a.inFlight.lastStep}` : " · starting…"}
                      </span>
                    </div>
                  )}
                  {a.lastSkip && (
                    <div className="text-[10.5px] mt-1" style={{ color: "#fbbf24" }}>
                      skipped {relTime(a.lastSkip.at)} — {a.lastSkip.reason}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => runNow(a)} disabled={busy[`run:${a.id}`]} title="Run now (counts toward the daily cap)"
                          className="grid place-items-center w-8 h-8 rounded-md transition hover:bg-[rgba(255,255,255,0.06)] disabled:opacity-50"
                          style={{ color: "#86efac" }}>
                    {busy[`run:${a.id}`] ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                  </button>
                  <button onClick={() => setRunsFor(a)} title="Run history"
                          className="grid place-items-center w-8 h-8 rounded-md transition hover:bg-[rgba(255,255,255,0.06)]"
                          style={{ color: "var(--cream-dim)" }}>
                    <History size={14} />
                  </button>
                  <button onClick={() => setEditing(a)} title="Edit"
                          className="grid place-items-center w-8 h-8 rounded-md transition hover:bg-[rgba(255,255,255,0.06)]"
                          style={{ color: "var(--cream-dim)" }}>
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => remove(a)} title="Delete (keeps run history)"
                          className="grid place-items-center w-8 h-8 rounded-md transition hover:bg-[rgba(255,255,255,0.06)]"
                          style={{ color: "#fb7185" }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                  <div className="h-full rounded-full transition-all"
                       style={{
                         width: `${Math.min(100, (a.runsToday / cap) * 100)}%`,
                         background: a.runsToday >= cap ? "#fb7185" : "var(--gold)",
                       }} />
                </div>
                <span className="text-[10.5px] mono shrink-0" style={{ color: a.runsToday >= cap ? "#fb7185" : "var(--cream-mute)" }}>
                  {a.runsToday}/{cap} today
                </span>
                <button onClick={() => toggle(a)}
                        className="text-[10.5px] px-2 py-1 rounded-md transition hover:bg-[rgba(255,255,255,0.06)] shrink-0"
                        style={{ color: a.enabled ? "#86efac" : "#94a3b8" }}>
                  {a.enabled ? "enabled" : "enable"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <AnimatePresence>
        {editing && (
          <AutomationModal
            key="modal"
            editing={editing === "new" ? null : editing}
            routers={routers} builders={builders}
            onClose={(saved) => { setEditing(null); if (saved) void load({ force: true }); }}
          />
        )}
        {runsFor && <RunsDrawer key="runs" automation={runsFor} onClose={() => setRunsFor(null)} />}
      </AnimatePresence>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------- modal

function AutomationModal({ editing, routers, builders, onClose }: {
  editing: Automation | null;
  routers: RefOption[]; builders: RefOption[];
  onClose: (saved: boolean) => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [prompt, setPrompt] = useState(editing?.prompt ?? "");
  const [brainKind, setBrainKind] = useState<"router" | "builder" | "firstmate">(editing?.brainRef.kind ?? "router");
  const [refId, setRefId] = useState(
    editing ? (editing.brainRef.kind === "builder" ? editing.brainRef.builderId : editing.brainRef.routerId) : "",
  );
  const [schedKind, setSchedKind] = useState<"interval" | "time">(editing?.timeOfDay ? "time" : "interval");
  const [intervalMin, setIntervalMin] = useState(editing?.intervalMin ?? 60);
  const [timeOfDay, setTimeOfDay] = useState(editing?.timeOfDay ?? "09:00");
  const [requiresApproval, setRequiresApproval] = useState(editing?.requiresApproval ?? true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const options = brainKind === "builder" ? builders : routers;
  const chosen = refId || options[0]?.id || "";

  async function save() {
    setSaving(true); setError(null);
    const payload: Record<string, unknown> = {
      name, prompt, requiresApproval,
      brainRef: brainKind === "builder" ? { kind: "builder", builderId: chosen } : { kind: brainKind, routerId: chosen },
      intervalMin: schedKind === "interval" ? intervalMin : null,
      timeOfDay: schedKind === "time" ? timeOfDay : null,
    };
    const res = editing
      ? await fetch(`/api/automations/${editing.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) })
      : await fetch("/api/automations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const j = await readJson(res);
    setSaving(false);
    if (j.error) { setError(String(j.error)); return; }
    onClose(true);
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={() => onClose(false)}
    >
      <motion.div
        initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 16, opacity: 0 }}
        className="panel w-full max-w-lg p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-[15px] font-medium">{editing ? "Edit automation" : "New automation"}</h3>
          <button onClick={() => onClose(false)} className="text-[var(--cream-mute)] hover:text-[var(--cream)]"><X size={16} /></button>
        </div>

        <label className="block space-y-1">
          <span className="text-[11px] uppercase tracking-wider text-[var(--cream-mute)]">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Morning briefing"
                 className="w-full bg-transparent border border-[var(--line-soft)] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[var(--gold)]" />
        </label>

        <label className="block space-y-1">
          <span className="text-[11px] uppercase tracking-wider text-[var(--cream-mute)]">Prompt — the whole job</span>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3}
                    placeholder="Summarize what changed in the vault since yesterday into notes/briefing.md"
                    className="w-full bg-transparent border border-[var(--line-soft)] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[var(--gold)] resize-y" />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-[11px] uppercase tracking-wider text-[var(--cream-mute)]">Brain kind</span>
            <select value={brainKind} onChange={(e) => { setBrainKind(e.target.value as "router" | "builder" | "firstmate"); setRefId(""); }}
                    className="w-full bg-transparent border border-[var(--line-soft)] rounded-lg px-3 py-2 text-[13px] outline-none">
              <option value="router">Router (runtime agent)</option>
              <option value="firstmate">Sen (deliverable agent)</option>
              <option value="builder">Builder (CLI one-shot)</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] uppercase tracking-wider text-[var(--cream-mute)]">{brainKind === "builder" ? "Builder" : "Router"}</span>
            <select value={chosen} onChange={(e) => setRefId(e.target.value)}
                    className="w-full bg-transparent border border-[var(--line-soft)] rounded-lg px-3 py-2 text-[13px] outline-none">
              {options.length === 0 && <option value="">— none configured —</option>}
              {options.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.hint})</option>)}
            </select>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-[11px] uppercase tracking-wider text-[var(--cream-mute)]">Schedule</span>
            <select value={schedKind} onChange={(e) => setSchedKind(e.target.value as "interval" | "time")}
                    className="w-full bg-transparent border border-[var(--line-soft)] rounded-lg px-3 py-2 text-[13px] outline-none">
              <option value="interval">Every N minutes</option>
              <option value="time">Daily at a time</option>
            </select>
          </label>
          {schedKind === "interval" ? (
            <label className="block space-y-1">
              <span className="text-[11px] uppercase tracking-wider text-[var(--cream-mute)]">Minutes (30–1440)</span>
              <input type="number" min={30} max={1440} value={intervalMin}
                     onChange={(e) => setIntervalMin(Number(e.target.value))}
                     className="w-full bg-transparent border border-[var(--line-soft)] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[var(--gold)]" />
            </label>
          ) : (
            <label className="block space-y-1">
              <span className="text-[11px] uppercase tracking-wider text-[var(--cream-mute)]">Time (local)</span>
              <input type="time" value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value)}
                     className="w-full bg-transparent border border-[var(--line-soft)] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[var(--gold)]" />
            </label>
          )}
        </div>

        <label className="flex items-start gap-2.5 cursor-pointer">
          <input type="checkbox" checked={requiresApproval} onChange={(e) => setRequiresApproval(e.target.checked)} className="mt-0.5" />
          <span className="text-[12px] text-[var(--fg-dim)]">
            Require approval for write &amp; external tools
            {brainKind === "builder" && (
              <span className="block text-[10.5px] text-[var(--cream-mute)] mt-0.5">
                Only gates Router brains — a Builder one-shot has no tools to park.
              </span>
            )}
          </span>
        </label>

        {error && <div className="text-[12px] text-rose-300">{error}</div>}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={() => onClose(false)} className="text-[12px] px-3 py-2 rounded-lg text-[var(--cream-dim)] hover:bg-[rgba(255,255,255,0.06)]">
            Cancel
          </button>
          <button onClick={save} disabled={saving || !name.trim() || !prompt.trim() || !chosen}
                  className="flex items-center gap-1.5 text-[12px] px-4 py-2 rounded-lg transition hover:brightness-110 disabled:opacity-50"
                  style={{ background: "rgba(212,165,116,0.2)", color: "var(--gold)" }}>
            {saving && <Loader2 size={12} className="animate-spin" />}
            {editing ? "Save" : "Create"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// --------------------------------------------------------------------- drawer

function RunsDrawer({ automation, onClose }: { automation: Automation; onClose: () => void }) {
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [live, setLive] = useState<LiveRun | null>(null);
  const [transcript, setTranscript] = useState<{ runId: string; text: string } | null>(null);
  const [loadingTs, setLoadingTs] = useState<string | null>(null);

  async function load() {
    const j = await readJson(await fetch(`/api/automations/${automation.id}/runs`, { cache: "no-store" }));
    setRuns((j.runs as AutomationRun[]) ?? []);
    setLive((j.live as LiveRun | null) ?? null);
  }
  useEffect(() => { void load(); }, [automation.id]);   // first paint on open
  // Poll only while a run is live; the response that shows it settled is the
  // last fetch, and it already carries the finished record.
  usePollWhileVisible(load, 5000, [automation.id], Boolean(live));

  async function showTranscript(runId: string) {
    if (transcript?.runId === runId) { setTranscript(null); return; }
    setLoadingTs(runId);
    const j = await readJson(await fetch(`/api/automations/${automation.id}/runs?transcript=${runId}`, { cache: "no-store" }));
    setTranscript({ runId, text: (j.transcript as string) ?? "(no transcript — builder runs return text inline)" });
    setLoadingTs(null);
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50" style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={onClose}
    >
      <motion.div
        initial={{ x: 420 }} animate={{ x: 0 }} exit={{ x: 420 }}
        transition={{ type: "spring", stiffness: 320, damping: 32 }}
        className="absolute right-0 top-0 h-full w-full max-w-md p-5 overflow-y-auto space-y-3"
        style={{ background: "var(--bg-mid)", borderLeft: "1px solid var(--line-soft)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-[15px] font-medium">Runs · {automation.name}</h3>
          <button onClick={onClose} className="text-[var(--cream-mute)] hover:text-[var(--cream)]"><X size={16} /></button>
        </div>

        {live && (
          <div className="panel p-3 space-y-2" style={{ borderColor: "rgba(125,211,252,0.35)" }}>
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-[11px] px-2 py-0.5 rounded-full mono"
                    style={{ background: "rgba(125,211,252,0.12)", color: "#7dd3fc" }}>
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60" style={{ background: "#7dd3fc" }} />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: "#7dd3fc" }} />
                </span>
                running
              </span>
              <span className="text-[10.5px] text-[var(--cream-mute)] mono">
                since {relTime(new Date(live.sinceMs).toISOString())}
              </span>
            </div>
            {live.steps.length > 0 ? (
              <div className="space-y-1">
                {live.steps.map((s, i) => (
                  <div key={i} className="text-[10.5px] text-[var(--fg-dim)] mono truncate" title={stepTitle(s)}>
                    <span style={{ color: "var(--cream-mute)" }}>{s.kind} · </span>{stepTitle(s)}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[11px] text-[var(--cream-mute)]">Starting up — no steps in the state file yet.</div>
            )}
            <button onClick={() => showTranscript(live.runId)}
                    className="flex items-center gap-1 text-[10.5px] transition hover:brightness-125"
                    style={{ color: "var(--gold)" }}>
              {loadingTs === live.runId ? <Loader2 size={11} className="animate-spin" /> : <FileText size={11} />}
              {transcript?.runId === live.runId ? "Hide live transcript" : "Live transcript"}
            </button>
            {transcript?.runId === live.runId && (
              <pre className="text-[10px] mono text-[var(--fg-dim)] whitespace-pre-wrap break-all rounded-md p-2 max-h-72 overflow-y-auto"
                   style={{ background: "rgba(0,0,0,0.3)" }}>
                {transcript.text}
              </pre>
            )}
          </div>
        )}

        {runs.length === 0 && !live && <div className="text-[12px] text-[var(--cream-mute)]">No runs yet.</div>}

        {runs.map((r) => (
          <div key={r.id} className="panel p-3 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] px-2 py-0.5 rounded-full mono"
                    style={{ background: "rgba(255,255,255,0.06)", color: STATUS_COLOR[r.status] ?? "#94a3b8" }}>
                {r.status}
              </span>
              <span className="text-[10.5px] text-[var(--cream-mute)] mono">
                {r.trigger} · {relTime(r.startedAt)} · {(r.durationMs / 1000).toFixed(1)}s
                {r.assetVersion && ` · v:${r.assetVersion.slice(0, 8)}`}
              </span>
            </div>
            <div className="text-[11.5px] text-[var(--fg-dim)] whitespace-pre-wrap break-words">
              {r.output.kind === "runtime" ? r.output.finalText || "(no final text)" : r.output.error ?? r.output.text}
            </div>
            {r.output.kind === "runtime" && (
              <button onClick={() => showTranscript(r.id)}
                      className="flex items-center gap-1 text-[10.5px] transition hover:brightness-125"
                      style={{ color: "var(--gold)" }}>
                {loadingTs === r.id ? <Loader2 size={11} className="animate-spin" /> : <FileText size={11} />}
                {transcript?.runId === r.id ? "Hide transcript" : "Transcript"}
              </button>
            )}
            {transcript?.runId === r.id && (
              <pre className="text-[10px] mono text-[var(--fg-dim)] whitespace-pre-wrap break-all rounded-md p-2 max-h-72 overflow-y-auto"
                   style={{ background: "rgba(0,0,0,0.3)" }}>
                {transcript.text}
              </pre>
            )}
          </div>
        ))}
      </motion.div>
    </motion.div>
  );
}
