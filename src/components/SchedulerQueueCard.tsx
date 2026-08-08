"use client";

import { useCallback, useEffect, useState } from "react";
import { ListChecks, RefreshCw, TriangleAlert } from "lucide-react";

// Dry-run scheduler queue (phase 10 step 6): shows the fairness-ordered
// decisions with their readiness states and reasons. Read-only explanation —
// the scheduler never commits from this surface.

interface SchedulerDecision {
  taskId: string;
  goalId: string;
  title: string;
  state: string;
  reasons: string[];
}

interface SchedulerQueue {
  available: boolean;
  dryRun: boolean;
  decisions: SchedulerDecision[];
  derivations: string[];
}

const STATE_STYLE: Record<string, { color: string; label: string }> = {
  ready: { color: "#86efac", label: "ready" },
  blocked: { color: "#fb7185", label: "blocked" },
  waiting_dependency: { color: "#fbbf24", label: "waiting · dependency" },
  waiting_quota: { color: "#fbbf24", label: "waiting · quota" },
  waiting_lock: { color: "#fbbf24", label: "waiting · lock" },
  waiting_builder: { color: "#fbbf24", label: "waiting · builder" },
  waiting_sandbox: { color: "#fbbf24", label: "waiting · sandbox" },
  waiting_wip: { color: "#fbbf24", label: "waiting · wip" },
};

function isSchedulerQueue(value: unknown): value is SchedulerQueue {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SchedulerQueue>;
  return typeof candidate.available === "boolean"
    && Array.isArray(candidate.decisions)
    && (!("derivations" in candidate) || Array.isArray(candidate.derivations));
}

export default function SchedulerQueueCard() {
  const [queue, setQueue] = useState<SchedulerQueue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/sen/scheduler/queue", { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !isSchedulerQueue(body)) {
        setError(`scheduler queue returned ${res.status}`);
        setQueue(null);
        return;
      }
      setQueue(body);
      setError(null);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
      setQueue(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <section
      className="aura-border aura-border--soft rounded-xl border p-4 space-y-2"
      style={{ borderColor: "var(--panel-border)", background: "var(--panel, rgba(255,255,255,0.02))" }}
    >
      <div className="flex items-center gap-2">
        <ListChecks size={14} style={{ color: "var(--gold)" }} />
        <h3 className="text-[13px] font-medium">Scheduler queue</h3>
        {queue && (
          <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ color: "#7dd3fc", background: "rgba(125,211,252,0.12)" }}>
            {queue.available ? "dry-run" : "offline"}
          </span>
        )}
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          title="Refresh scheduler queue"
          className="ml-auto grid h-6 w-6 place-items-center rounded-md border transition hover:bg-white/5 disabled:opacity-50"
          style={{ borderColor: "var(--panel-border)", color: "var(--fg-dim)" }}
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-[12px]" style={{ color: "#fb7185" }}>
          <TriangleAlert size={13} /> Could not load the scheduler queue: {error}
        </div>
      )}
      {!error && !queue && <div className="text-[12px]" style={{ color: "var(--fg-dim)" }}>Loading…</div>}
      {!error && queue && !queue.available && (
        <div className="text-[12px]" style={{ color: "var(--fg-dim)" }}>
          The Go control plane is unavailable or not configured — the dry-run queue is offline.
        </div>
      )}
      {!error && queue?.available && queue.decisions.length === 0 && (
        <div className="text-[12px]" style={{ color: "var(--fg-dim)" }}>No schedulable tasks right now.</div>
      )}
      {!error && queue?.available && queue.decisions.length > 0 && (
        <ul className="space-y-1 text-[12px]">
          {queue.decisions.map((decision) => {
            const style = STATE_STYLE[decision.state] ?? { color: "var(--fg-dim)", label: decision.state };
            return (
              <li key={decision.taskId} className="flex items-start gap-2">
                <span
                  className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                  style={{ color: style.color, background: `${style.color}1f` }}
                >
                  {style.label}
                </span>
                <span style={{ color: "var(--fg)" }}>{decision.title || decision.taskId}</span>
                <span className="truncate" style={{ color: "var(--fg-dim)" }}>{(decision.reasons ?? []).join("; ")}</span>
              </li>
            );
          })}
        </ul>
      )}
      {!error && queue?.available && (queue.derivations ?? []).length > 0 && (
        <div className="text-[10.5px] border-t pt-2" style={{ color: "var(--fg-dim)", borderColor: "var(--panel-border)" }}>
          Derived defaults: {(queue.derivations ?? []).join(" · ")}
        </div>
      )}
    </section>
  );
}
