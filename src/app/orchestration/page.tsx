"use client";

import { useEffect, useState } from "react";

import { trackForLane } from "@/lib/orchestration-board";
import type { BoardTrack } from "@/lib/orchestration-board";
import type { OrchestrationLaneView } from "@/lib/orchestration-state";

interface ApiEnvelope {
  result: { lanes: OrchestrationLaneView[]; generatedAt: string } | null;
  error: { code: string; status: number } | null;
}

const ACTIVE = new Set(["DISPATCHED", "RUNNING", "WAITING_ON"]);

const TRACK_LABELS: Record<BoardTrack, string> = {
  A: "Lane A — community",
  B: "Lane B — controlled delivery",
  C: "Lane C — integration / governance",
};

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: "text-blue-700",
  QUEUED: "text-slate-600",
  DONE: "text-emerald-700",
  IDLE: "text-slate-400",
};

/** One status per Orca lane card. */
function trackStatus(laneList: OrchestrationLaneView[]): { status: string; detail: string } {
  if (laneList.length === 0) return { status: "IDLE", detail: "no lanes" };
  const running = laneList.filter((l) => ACTIVE.has(l.currentState));
  if (running.length > 0) {
    return {
      status: "ACTIVE",
      detail: running.map((l) => `${l.lane} (${l.currentState})`).join(", "),
    };
  }
  const queued = laneList.filter((l) => l.currentState === "QUEUED");
  if (queued.length > 0) return { status: "QUEUED", detail: `queued: ${queued.map((l) => l.lane).join(", ")}` };
  return {
    status: "DONE",
    detail: `${laneList.length} task${laneList.length === 1 ? "" : "s"} finished`,
  };
}

export default function OrchestrationPage() {
  const [lanes, setLanes] = useState<OrchestrationLaneView[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/orchestration/state")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((envelope: ApiEnvelope) => {
        if (envelope.error || !envelope.result) {
          setError(envelope.error?.code ?? "no result");
          return;
        }
        setLanes(envelope.result.lanes);
        setGeneratedAt(envelope.result.generatedAt);
      })
      .catch((reason: unknown) => setError(String((reason as Error).message ?? reason)));
  }, []);

  const tracks: BoardTrack[] = ["A", "B", "C"];
  const views = tracks.map((track) => ({
    track,
    label: TRACK_LABELS[track],
    ...trackStatus(lanes.filter((l) => trackForLane(l.lane) === track)),
  }));

  return (
    <main className="p-6 max-w-4xl mx-auto">
      <div className="border-2 border-rose-400 bg-rose-50 text-rose-800 rounded px-3 py-2 text-sm mb-6">
        READ-ONLY ORCHESTRATION STATE — no execution authority. This page reads
        the append-only state journal; it cannot dispatch, promote, or write.
        legacy_writer: disabled; phase_21: blocked.
      </div>

      <header className="mb-5">
        <h1 className="text-xl font-semibold">Orca lanes</h1>
        <p className="text-sm text-slate-500">
          {generatedAt ? `journal snapshot ${generatedAt}` : "loading…"}
        </p>
      </header>

      {error && <p className="text-rose-700 mb-4">failed to load state: {error}</p>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {views.map((v) => (
          <div
            key={v.track}
            className="rounded border bg-white shadow-sm p-5 text-center flex flex-col items-center justify-center gap-1"
          >
            <div className="text-sm font-semibold text-slate-700">{v.label}</div>
            <div className={`text-2xl font-bold ${STATUS_STYLE[v.status] ?? "text-slate-700"}`}>
              {v.status}
            </div>
            {v.detail && <div className="text-xs text-slate-500">{v.detail}</div>}
          </div>
        ))}
      </div>

      {lanes.length === 0 && !error && (
        <p className="text-sm text-slate-500 mt-6">no lanes in the journal yet.</p>
      )}
    </main>
  );
}