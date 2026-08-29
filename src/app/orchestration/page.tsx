"use client";

import { useEffect, useState } from "react";

import {
  deriveCardStatus,
  laneCounters,
  trackForLane,
} from "@/lib/orchestration-board";
import type { BoardTrack } from "@/lib/orchestration-board";
import type { OrchestrationLaneView } from "@/lib/orchestration-state";

interface ApiEnvelope {
  result: { lanes: OrchestrationLaneView[]; generatedAt: string } | null;
  error: { code: string; status: number } | null;
}

const TRACK_LABELS: Record<BoardTrack, string> = {
  A: "Lane A — community",
  B: "Lane B — controlled delivery",
  C: "Lane C — integration / governance",
};

const LANE_IDS: Record<BoardTrack, string> = {
  A: "lane-a",
  B: "lane-b",
  C: "lane-c",
};

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: "text-blue-700",
  DONE: "text-emerald-700",
  IDLE: "text-slate-400",
  IDLE_WITH_WORK: "text-amber-700",
  HOLD_INTERNAL: "text-orange-700",
  HOLD_LANE: "text-amber-700",
  HOLD_APPROVAL: "text-purple-700",
  HOLD_TIME: "text-sky-700",
};

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
        {tracks.map((track) => {
          const laneId = LANE_IDS[track];
          const lifecycleEvent = lanes.find((l) => l.lane === laneId);
          const taskLanes = lanes.filter(
            (l) => l.lane !== laneId && trackForLane(l.lane) === track,
          );
          const counters = laneCounters(taskLanes.map((l) => l.currentState));
          const status = deriveCardStatus(counters, lifecycleEvent?.currentState);
          const holdDetail = lifecycleEvent?.prerequisite;

          return (
            <div
              key={track}
              className="rounded border bg-white shadow-sm p-5 flex flex-col gap-3"
            >
              <div className="text-sm font-semibold text-slate-700">{TRACK_LABELS[track]}</div>
              <div className={`text-2xl font-bold ${STATUS_STYLE[status] ?? "text-slate-700"}`}>
                {status}
              </div>
              {status.startsWith("HOLD_") && holdDetail && (
                <div className="text-xs bg-slate-50 rounded px-2 py-1 text-slate-600">
                  {status === "HOLD_LANE" && `waiting on: ${holdDetail}`}
                  {status === "HOLD_APPROVAL" && `approval needed: ${holdDetail}`}
                  {status === "HOLD_TIME" && `resume: ${holdDetail}`}
                  {status === "HOLD_INTERNAL" && `lane issue: ${holdDetail}`}
                </div>
              )}

              {/* Task counters: finished / running / queued */}
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded bg-green-50 px-2 py-1">
                  <div className="text-lg font-bold text-green-800">{counters.done}</div>
                  <div className="text-[11px] text-green-700">done</div>
                </div>
                <div className="rounded bg-blue-50 px-2 py-1">
                  <div className="text-lg font-bold text-blue-800">{counters.active}</div>
                  <div className="text-[11px] text-blue-700">active</div>
                </div>
                <div className="rounded bg-amber-50 px-2 py-1">
                  <div className="text-lg font-bold text-amber-800">{counters.pending}</div>
                  <div className="text-[11px] text-amber-700">pending</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {lanes.length === 0 && !error && (
        <p className="text-sm text-slate-500 mt-6">no lanes in the journal yet.</p>
      )}
    </main>
  );
}