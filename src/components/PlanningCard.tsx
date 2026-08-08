"use client";

import { useCallback, useEffect, useState } from "react";
import { ClipboardList, RefreshCw } from "lucide-react";

// Planning surface (phase 12 step 7): shows the goal-linked plan version —
// outcome, open questions, approval state. Read-only; approval actions land
// with the approval-prompt step. Renders only for goal-linked sessions.

interface PlanVersion {
  ID: string;
  GoalID: string;
  Version: number;
  Outcome: string;
  OpenQuestions?: string[];
  Approval: string;
  DiffFromPrevious?: string;
}

interface PlanResponse {
  available: boolean;
  plan: PlanVersion | null;
}

const APPROVAL_STYLE: Record<string, { color: string; label: string }> = {
  draft: { color: "#fbbf24", label: "draft" },
  approved: { color: "#86efac", label: "approved" },
  rejected: { color: "#fb7185", label: "rejected" },
};

export default function PlanningCard({ goalId }: { goalId: string }) {
  const [data, setData] = useState<PlanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setData(null);
    setError(null);
    try {
      const res = await fetch(`/api/sen/planning/goals/${encodeURIComponent(goalId)}/plan`, { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body || typeof body.available !== "boolean") {
        setError(`planning returned ${res.status}`);
        setData(null);
        return;
      }
      setData(body as PlanResponse);
      setError(null);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [goalId]);

  useEffect(() => { void load(); }, [load]);

  if (error) {
    return (
      <div className="rounded-xl border p-3 text-[11.5px]" style={{ borderColor: "var(--panel-border)", color: "#fb7185" }}>
        Could not load the plan: {error}
      </div>
    );
  }
  if (!data || !data.available || !data.plan) return null;

  const plan = data.plan;
  const style = APPROVAL_STYLE[plan.Approval] ?? { color: "var(--fg-dim)", label: plan.Approval };
  return (
    <section
      className="aura-border aura-border--soft rounded-xl border p-3 space-y-2 mx-4 mt-2"
      style={{ borderColor: "var(--panel-border)", background: "var(--panel, rgba(255,255,255,0.02))" }}
    >
      <div className="flex items-center gap-2">
        <ClipboardList size={13} style={{ color: "var(--gold)" }} />
        <h3 className="text-[12px] font-medium">Plan · v{plan.Version}</h3>
        <span
          className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
          style={{ color: style.color, background: `${style.color}1f` }}
        >
          {style.label}
        </span>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          title="Refresh plan"
          className="ml-auto grid h-6 w-6 place-items-center rounded-md border transition hover:bg-white/5 disabled:opacity-50"
          style={{ borderColor: "var(--panel-border)", color: "var(--fg-dim)" }}
        >
          <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
        </button>
      </div>
      <div className="text-[12px]" style={{ color: "var(--fg)" }}>{plan.Outcome}</div>
      {plan.DiffFromPrevious && (
        <div className="text-[10.5px] mono" style={{ color: "var(--fg-dim)" }}>{plan.DiffFromPrevious}</div>
      )}
      {plan.OpenQuestions && plan.OpenQuestions.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--fg-dimmer)" }}>Open questions</div>
          <ul className="mt-1 space-y-0.5 text-[11.5px]" style={{ color: "var(--fg-dim)" }}>
            {plan.OpenQuestions.map((question) => <li key={question}>· {question}</li>)}
          </ul>
        </div>
      )}
      <div className="text-[10px] mono" style={{ color: "var(--fg-dimmer)" }}>goal {plan.GoalID}</div>
    </section>
  );
}
