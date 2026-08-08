"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  Bot,
  CalendarClock,
  CheckCircle2,
  Gauge,
  KanbanSquare,
  Loader2,
  MessageSquare,
  RefreshCw,
  Repeat,
} from "lucide-react";
import GoalsView from "./GoalsView";
import TokenUsage from "./TokenUsage";
import ActivityStream from "./ActivityStream";

interface FleetBoardSummary {
  verifiedWorkers?: number;
  workers?: { id?: string; name?: string; cli?: string; quota?: { text?: string } | null; verifiedAt?: string }[];
  quota?: { summary?: string; text?: string; constrained?: number; exhausted?: number } | string | null;
  fallbackChain?: (string | { id?: string; name?: string })[];
  fallbackBuilders?: string[];
  board?: {
    total?: number;
    workflow?: Record<string, number>;
    runtime?: Record<string, number>;
    attention?: number;
    activeAttempts?: number;
  };
  firstmate?: {
    sessions?: number;
    kanbanSessions?: number;
    recent?: { id?: string; title?: string; kind?: string; updatedAt?: string }[];
  };
  stageCounts?: Record<string, number>;
  workflow?: Record<string, number>;
  attention?: Record<string, number>;
  attentionCounts?: Record<string, number>;
  recent?: {
    sessions?: { id?: string; title?: string; updatedAt?: string }[];
    attempts?: { id?: string; cardId?: string; title?: string; status?: string; builder?: string; builderName?: string; updatedAt?: string }[];
  };
  recentSessions?: { id?: string; title?: string; updatedAt?: string }[];
  recentAttempts?: { id?: string; cardId?: string; title?: string; status?: string; builder?: string; builderName?: string; updatedAt?: string }[];
  llmops?: {
    totalRuns: number;
    successRuns: number;
    failedRuns: number;
    inputTokens: number;
    outputTokens: number;
    totalDurationMs: number;
  };
}

export default function Overview({
  onOpenTab,
}: {
  onOpenTab?: (tab: string) => void;
} = {}) {
  const [fleetBoard, setFleetBoard] = useState<FleetBoardSummary | null>(null);
  const [fleetBoardErr, setFleetBoardErr] = useState<string | null>(null);
  const [fleetBoardLoading, setFleetBoardLoading] = useState(true);

  const loadFleetBoard = useCallback(async () => {
    setFleetBoardLoading(true);
    try {
      const response = await fetch("/api/overview/fleet-board", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(body.error ?? `HTTP ${response.status}`));
      setFleetBoard(body as FleetBoardSummary);
      setFleetBoardErr(null);
    } catch (error) {
      setFleetBoardErr(String(error instanceof Error ? error.message : error));
    } finally {
      setFleetBoardLoading(false);
    }
  }, []);

  useEffect(() => { void loadFleetBoard(); }, [loadFleetBoard]);

  return (
    <div className="space-y-10">
      <section className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <DashShortcut
          title="Automations"
          sub="Scheduled Sen runs + approval inbox"
          icon={<CalendarClock size={16} />}
          accent="#fbbf24"
          href="/automations"
          onOpen={onOpenTab ? () => onOpenTab("automations") : undefined}
        />
        <DashShortcut
          title="Loop"
          sub="Builder acts · Fusion verifies until done"
          icon={<Repeat size={16} />}
          accent="#2dd4bf"
          href="/loop"
          onOpen={onOpenTab ? () => onOpenTab("loop") : undefined}
        />
      </section>

      <section>
        <GoalsView embedded />
      </section>

      <div className="divider">
        <span className="rule" />
        <span className="ornament">✦</span>
        <span className="rule" />
      </div>

      <section>
        <FleetBoardWidget
          data={fleetBoard}
          error={fleetBoardErr}
          loading={fleetBoardLoading}
          onRefresh={() => void loadFleetBoard()}
        />
      </section>

      <div className="divider">
        <span className="rule" />
        <span className="ornament">✦</span>
        <span className="rule" />
      </div>

      <section>
        <TokenUsage />
      </section>

      <div className="divider">
        <span className="rule" />
        <span className="ornament">✦</span>
        <span className="rule" />
      </div>

      <section>
        <ActivityStream />
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ helpers

function DashShortcut({
  title, sub, icon, accent, href, onOpen,
}: {
  title: string;
  sub: string;
  icon: ReactNode;
  accent: string;
  href: string;
  onOpen?: () => void;
}) {
  const className = "flex items-start gap-3 rounded-xl border p-3 text-left transition hover:brightness-110";
  const style = { borderColor: "var(--line-soft)", background: "var(--bg-mid)" } as const;
  const body = (
    <>
      <span
        className="grid h-9 w-9 place-items-center rounded-lg shrink-0"
        style={{ background: `${accent}22`, color: accent }}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium" style={{ color: "var(--cream)" }}>{title}</span>
        <span className="block text-[11px] mt-0.5" style={{ color: "var(--cream-mute)" }}>{sub}</span>
      </span>
      <ArrowUpRight size={14} className="ml-auto shrink-0 mt-1" style={{ color: "var(--cream-mute)" }} />
    </>
  );
  if (onOpen) {
    return (
      <button type="button" onClick={onOpen} className={className} style={style}>
        {body}
      </button>
    );
  }
  return (
    <Link href={href} className={className} style={style}>
      {body}
    </Link>
  );
}

const STAGE_ORDER = [
  ["backlog", "Backlog", "#a59783"],
  ["todo", "To do", "#d4a574"],
  ["doing", "Doing", "#7dd3fc"],
  ["ready2review", "Review", "#c084fc"],
  ["reviewed", "Reviewed", "#5ab896"],
  ["committed", "Commit", "#fbbf24"],
  ["merging", "Merge", "#fb923c"],
  ["archived", "Archive", "#6e6353"],
] as const;

function FleetBoardWidget({
  data,
  error,
  loading,
  onRefresh,
}: {
  data: FleetBoardSummary | null;
  error: string | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  const stages = data?.stageCounts ?? data?.workflow ?? data?.board?.workflow ?? {};
  const attention = data?.attention ?? data?.attentionCounts ?? data?.board?.runtime ?? {};
  const verified = data?.verifiedWorkers ?? data?.workers?.length ?? 0;
  const fallback = data?.fallbackChain ?? data?.fallbackBuilders ?? [];
  const recentSessions = data?.recent?.sessions ?? data?.recentSessions ?? data?.firstmate?.recent ?? [];
  const recentAttempts = data?.recent?.attempts ?? data?.recentAttempts ?? [];
  const quotaText = typeof data?.quota === "string"
    ? data.quota
    : data?.quota?.summary ?? data?.quota?.text
      ?? (data?.quota?.exhausted
        ? `${data.quota.exhausted} exhausted`
        : data?.quota?.constrained
          ? `${data.quota.constrained} constrained`
          : "No quota alerts");
  const attentionTotal = data?.board?.attention ?? Object.values(attention).reduce(
    (sum, value) => sum + (Number(value) || 0),
    0,
  );
  const workersQuota = data?.workers
    ?.map((worker) => worker.quota?.text)
    .filter((value): value is string => Boolean(value))
    .slice(0, 2)
    .join(" · ");

  return (
    <div className="surface-card relative overflow-hidden">
      <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-[#7dd3fc] opacity-[.06] blur-3xl" />
      <div className="relative flex flex-wrap items-start gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-lg border" style={{ borderColor: "rgba(125,211,252,.28)", background: "rgba(125,211,252,.09)", color: "#7dd3fc" }}>
          <KanbanSquare size={20} />
        </div>
        <div>
          <h2 className="text-[18px] font-medium">Sen Overview</h2>
          <p className="mt-1 text-[12px]" style={{ color: "var(--cream-dim)" }}>
            Verified workers, fallback readiness, board flow, and attention in one isolated read.
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <Link href="/sen" className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border px-3 text-[11px]" style={{ borderColor: "var(--line-soft)", color: "var(--cream-soft)" }}>
            <MessageSquare size={12} /> Sen
          </Link>
          <Link href="/agent-kanban" className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-[11px] font-semibold" style={{ background: "#7dd3fc", color: "#07131d" }}>
            <KanbanSquare size={12} /> Agent Kanban
          </Link>
          <button onClick={onRefresh} aria-label="Refresh Fleet and Board" className="grid min-h-10 min-w-10 place-items-center rounded-lg border" style={{ borderColor: "var(--line-soft)", color: "var(--cream-dim)" }}>
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {loading && !data ? (
        <div className="mt-5 grid min-h-36 place-items-center rounded-xl border border-dashed" style={{ borderColor: "var(--line-soft)", color: "var(--cream-dim)" }}>
          <span className="inline-flex items-center gap-2 text-[12px]"><Loader2 size={14} className="animate-spin" /> Loading fleet and board…</span>
        </div>
      ) : error && !data ? (
        <div className="mt-5 flex min-h-28 items-center gap-3 rounded-xl border px-4" style={{ borderColor: "rgba(248,113,113,.35)", background: "rgba(248,113,113,.06)", color: "#fca5a5" }}>
          <AlertTriangle size={16} className="shrink-0" />
          <div className="min-w-0">
            <div className="text-[12px] font-medium">Fleet summary unavailable</div>
            <p className="mt-1 text-[11px] opacity-80">{error}</p>
          </div>
          <button onClick={onRefresh} className="ml-auto min-h-10 rounded-lg border px-3 text-[11px]" style={{ borderColor: "rgba(248,113,113,.35)" }}>Retry</button>
        </div>
      ) : (
        <>
          {error && (
            <div className="mt-4 flex items-center gap-2 text-[10.5px] text-[#fca5a5]">
              <AlertTriangle size={12} /> Refresh failed; showing the last good snapshot.
            </div>
          )}
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <MetricCard icon={<Bot size={15} />} label="Verified workers" value={String(verified)} note={workersQuota || quotaText} accent="#5ab896" />
            <MetricCard icon={<Gauge size={15} />} label="Fallback chain" value={String(fallback.length)} note={fallback.map((item) => typeof item === "string" ? item : item.name ?? item.id ?? "worker").join(" → ") || "No automatic fallback"} accent="#7dd3fc" />
            <MetricCard
              icon={attentionTotal ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />}
              label="Needs attention"
              value={String(attentionTotal)}
              note={[
                attention.needs_input ? `${attention.needs_input} input` : "",
                attention.failed ? `${attention.failed} failed` : "",
                attention.quota_wait ? `${attention.quota_wait} quota` : "",
                attention.blocked ? `${attention.blocked} blocked` : "",
              ].filter(Boolean).join(" · ") || "All clear"}
              accent={attentionTotal ? "#fbbf24" : "#5ab896"}
            />
          </div>

          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-[.18em]" style={{ color: "var(--cream-mute)" }}>Workflow snapshot</span>
              <span className="text-[10px]" style={{ color: "var(--cream-mute)" }}>{Object.values(stages).reduce((sum, value) => sum + (Number(value) || 0), 0)} cards</span>
            </div>
            <div className="grid grid-cols-4 gap-1.5 lg:grid-cols-8">
              {STAGE_ORDER.map(([key, label, accent]) => (
                <Link key={key} href="/agent-kanban" className="rounded-lg border p-2 transition hover:-translate-y-0.5" style={{ borderColor: "var(--line-soft)", background: `${accent}09` }}>
                  <span className="block text-[18px] font-medium" style={{ color: accent }}>{Number(stages[key] ?? 0)}</span>
                  <span className="mt-0.5 block truncate text-[9.5px] uppercase tracking-wide" style={{ color: "var(--cream-mute)" }}>{label}</span>
                </Link>
              ))}
            </div>
          </div>

          {(recentAttempts.length > 0 || recentSessions.length > 0) && (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <RecentList
                title="Active attempts"
                icon={<KanbanSquare size={12} />}
                empty="No recent attempts"
                items={recentAttempts.slice(0, 4).map((item) => ({
                  key: item.id ?? item.cardId ?? item.title ?? "attempt",
                  title: item.title ?? item.cardId ?? "Kanban attempt",
                  meta: [item.builderName ?? item.builder, item.status].filter(Boolean).join(" · "),
                  href: "/agent-kanban",
                }))}
              />
              <RecentList
                title="Sen sessions"
                icon={<MessageSquare size={12} />}
                empty="No recent sessions"
                items={recentSessions.slice(0, 4).map((item) => ({
                  key: item.id ?? item.title ?? "session",
                  title: item.title ?? item.id ?? "Sen session",
                  meta: item.updatedAt
                    ? new Date(item.updatedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
                    : "",
                  href: item.id ? `/sen?session=${encodeURIComponent(item.id)}` : "/sen",
                }))}
              />
            </div>
          )}

          {data?.llmops && (
            <div className="mt-4 rounded-xl border p-4" style={{ borderColor: "var(--line-soft)", background: "rgba(0,0,0,.08)" }}>
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-[.18em]" style={{ color: "var(--cream-mute)" }}>LLMOps Canonical Trace</span>
                <Link href="/sen" className="text-[10px] font-semibold text-[#7dd3fc] hover:underline">View Ledger</Link>
              </div>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-gray-500">Total Runs</div>
                  <div className="mt-1 text-[18px] text-gray-300">{data.llmops.totalRuns}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-gray-500">Success Rate</div>
                  <div className="mt-1 text-[18px] text-[#5ab896]">{data.llmops.totalRuns ? Math.round((data.llmops.successRuns / data.llmops.totalRuns) * 100) : 0}%</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-gray-500">Total Tokens</div>
                  <div className="mt-1 text-[18px] text-[#c084fc]">{(data.llmops.inputTokens + data.llmops.outputTokens).toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-gray-500">Compute Time</div>
                  <div className="mt-1 text-[18px] text-[#fbbf24]">{(data.llmops.totalDurationMs / 1000).toFixed(1)}s</div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MetricCard({ icon, label, value, note, accent }: { icon: React.ReactNode; label: string; value: string; note: string; accent: string }) {
  return (
    <div className="rounded-xl border p-3" style={{ borderColor: "var(--line-soft)", background: "rgba(0,0,0,.10)" }}>
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.14em]" style={{ color: "var(--cream-mute)" }}>
        <span style={{ color: accent }}>{icon}</span>{label}
      </div>
      <div className="mt-2 text-[25px] font-medium leading-none" style={{ color: accent }}>{value}</div>
      <p className="mt-2 line-clamp-2 text-[10.5px]" style={{ color: "var(--cream-dim)" }}>{note}</p>
    </div>
  );
}

function RecentList({ title, icon, empty, items }: { title: string; icon: React.ReactNode; empty: string; items: { key: string; title: string; meta: string; href: string }[] }) {
  return (
    <div className="rounded-xl border p-3" style={{ borderColor: "var(--line-soft)" }}>
      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[.14em]" style={{ color: "var(--cream-mute)" }}>{icon}{title}</div>
      {items.length === 0 ? <p className="text-[10.5px]" style={{ color: "var(--cream-dim)" }}>{empty}</p> : (
        <ul className="space-y-1">
          {items.map((item) => (
            <li key={item.key}>
              <Link href={item.href} className="flex min-h-10 items-center gap-2 rounded-lg px-2 transition hover:bg-white/[.03]">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11.5px]">{item.title}</span>
                  {item.meta && <span className="block truncate text-[9.5px]" style={{ color: "var(--cream-mute)" }}>{item.meta}</span>}
                </span>
                <ArrowUpRight size={11} style={{ color: "var(--cream-mute)" }} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}