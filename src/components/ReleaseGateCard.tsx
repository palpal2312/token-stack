"use client";

// Release gate card for the Sen "Reports & Plan" tab. Renders the Phase 20
// release-gate report served by GET /api/sen/operations?action=release-gate:
// overall status, cutover eligibility, and exactly which required coverage is
// missing. Read-only and fail-safe: an unreachable endpoint shows an error
// state, never a green badge.

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";

interface CoverageCheck {
  ruleId: string;
  suiteName: string;
  present: boolean;
}

interface ReleaseGateReport {
  status: "green" | "amber" | "blocked";
  canCutover: boolean;
  generatedAt: string;
  missingCoverage: CoverageCheck[];
  reasons: string[];
  observability: { status: "green" | "amber"; registered: boolean };
}

const STATUS_STYLE: Record<string, { color: string; background: string; label: string }> = {
  green: { color: "#86efac", background: "rgba(134,239,172,0.12)", label: "green — cutover eligible" },
  amber: { color: "#fbbf24", background: "rgba(251,191,36,0.12)", label: "amber — coverage incomplete" },
  // Emitted when recovery gate inputs report a failed backup verification;
  // the authoritative Go gate also blocks on open findings.
  blocked: { color: "#fb7185", background: "rgba(251,113,133,0.12)", label: "blocked — findings open" },
};

// Malformed 200 bodies must degrade to the error state, never crash the tab.
function isReleaseGateReport(value: unknown): value is ReleaseGateReport {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ReleaseGateReport>;
  return typeof candidate.status === "string"
    && typeof candidate.canCutover === "boolean"
    && Array.isArray(candidate.missingCoverage)
    && !!candidate.observability
    && typeof candidate.observability.status === "string";
}

export default function ReleaseGateCard() {
  const [report, setReport] = useState<ReleaseGateReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/sen/operations?action=release-gate", { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !isReleaseGateReport(body)) {
        setError(`release-gate returned ${res.status}`);
        setReport(null);
        return;
      }
      setReport(body);
      setError(null);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const style = report ? STATUS_STYLE[report.status] ?? STATUS_STYLE.amber : null;

  return (
    <section
      className="aura-border aura-border--soft rounded-xl border p-4 space-y-2"
      style={{ borderColor: "var(--panel-border)", background: "var(--panel, rgba(255,255,255,0.02))" }}
    >
      <div className="flex items-center gap-2">
        <ShieldCheck size={14} style={{ color: "var(--gold)" }} />
        <h3 className="text-[13px] font-medium">Release gate</h3>
        {style && (
          <span
            className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
            style={{ color: style.color, background: style.background }}
          >
            {style.label}
          </span>
        )}
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          title="Refresh release-gate report"
          className="ml-auto grid h-6 w-6 place-items-center rounded-md border transition hover:bg-white/5 disabled:opacity-50"
          style={{ borderColor: "var(--panel-border)", color: "var(--fg-dim)" }}
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-[12px]" style={{ color: "#fb7185" }}>
          <TriangleAlert size={13} /> Could not load the release-gate report: {error}
        </div>
      )}
      {!error && !report && (
        <div className="text-[12px]" style={{ color: "var(--fg-dim)" }}>Loading…</div>
      )}

      {report && (
        <div className="space-y-2">
          <div className="text-[11px] mono" style={{ color: "var(--fg-dim)" }}>
            generated {report.generatedAt} · observability catalog {report.observability.status}
          </div>
          {report.missingCoverage.length > 0 ? (
            <ul className="space-y-1 text-[12px]">
              {report.missingCoverage.map((item) => (
                <li key={`${item.ruleId}:${item.suiteName}`} className="flex items-start gap-2">
                  <TriangleAlert size={12} className="mt-0.5 shrink-0" style={{ color: "#fbbf24" }} />
                  <span>
                    <code style={{ color: "var(--fg)" }}>{item.suiteName}</code>
                    <span style={{ color: "var(--fg-dim)" }}> — {item.ruleId}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-[12px]" style={{ color: "#86efac" }}>
              All required coverage is registered.
            </div>
          )}
          {report.reasons.length > 0 && (
            <ul className="space-y-1 text-[12px]">
              {report.reasons.map((reason) => (
                <li key={reason} className="flex items-start gap-2">
                  <TriangleAlert size={12} className="mt-0.5 shrink-0" style={{ color: "#fb7185" }} />
                  <span style={{ color: "var(--fg-dim)" }}>{reason}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
