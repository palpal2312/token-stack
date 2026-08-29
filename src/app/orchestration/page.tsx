"use client";

import { useEffect, useState } from "react";

import { columnForState, trackForLane } from "@/lib/orchestration-board";
import type { BoardTrack } from "@/lib/orchestration-board";
import type { OrchestrationLaneView } from "@/lib/orchestration-state";

interface ApiEnvelope {
  result: {
    lanes: OrchestrationLaneView[];
    events: OrchestrationEvent[];
    generatedAt: string;
  } | null;
  error: { code: string; status: number } | null;
}

interface OrchestrationEvent {
  lane: string;
  transition: string;
  time?: string;
  summary: string;
}

const STATE_CLASSES: Record<string, string> = {
  QUEUED: "bg-slate-200 text-slate-700",
  DISPATCHED: "bg-sky-200 text-sky-800",
  RUNNING: "bg-blue-600 text-white",
  WAITING_ON: "bg-amber-200 text-amber-800",
  DONE: "bg-emerald-600 text-white",
  BLOCKED: "bg-rose-600 text-white",
  FAILED: "bg-rose-300 text-rose-900",
};

const TRACK_LABELS: Record<BoardTrack, string> = {
  A: "Lane A — community",
  B: "Lane B — controlled delivery",
  C: "Lane C — integration / governance",
};

const ACTIVE_STATES = new Set(["DISPATCHED", "RUNNING", "WAITING_ON"]);

/** Live indicator: green pulse = running now, amber = dispatched/waiting, gray = queued, none = terminal. */
function LiveDot({ state }: { state: string }) {
  if (state === "RUNNING") {
    return <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse" aria-label="running" />;
  }
  if (state === "DISPATCHED" || state === "WAITING_ON") {
    return <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-400" aria-label="active" />;
  }
  if (state === "QUEUED") {
    return <span className="inline-block w-2.5 h-2.5 rounded-full bg-slate-300" aria-label="queued" />;
  }
  return <span className="inline-block w-2.5 h-2.5 rounded-full bg-slate-200" aria-label="terminal" />;
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

  const active = lanes.filter((l) => ACTIVE_STATES.has(l.currentState));
  const queued = lanes.filter((l) => l.currentState === "QUEUED");
  const done = lanes.filter((l) => columnForState(l.currentState) === "done");

  const tracks: BoardTrack[] = ["A", "B", "C"];

  return (
    <main className="p-6 max-w-4xl mx-auto">
      <div className="border-2 border-rose-400 bg-rose-50 text-rose-800 rounded px-3 py-2 text-sm mb-6">
        READ-ONLY ORCHESTRATION STATE — no execution authority. This page reads
        the append-only state journal; it cannot dispatch, promote, or write.
        legacy_writer: disabled; phase_21: blocked.
      </div>

      <header className="mb-5">
        <h1 className="text-xl font-semibold">Orchestration state machine</h1>
        <p className="text-sm text-slate-500">
          {generatedAt ? `journal snapshot ${generatedAt}` : "loading…"}
        </p>
      </header>

      {error && <p className="text-rose-700 mb-4">failed to load state: {error}</p>}

      <section className="flex flex-wrap gap-3 mb-6">
        <div className="rounded border border-blue-300 bg-blue-50 px-3 py-2 text-sm">
          <span className="font-semibold text-blue-800">{active.length}</span>
          <span className="text-blue-800"> active lane{active.length === 1 ? "" : "s"}</span>
        </div>
        <div className="rounded border border-slate-300 bg-slate-50 px-3 py-2 text-sm">
          <span className="font-semibold text-slate-800">{queued.length}</span>
          <span className="text-slate-700"> queued</span>
        </div>
        <div className="rounded border border-green-300 bg-green-50 px-3 py-2 text-sm">
          <span className="font-semibold text-green-800">{done.length}</span>
          <span className="text-green-800"> done</span>
        </div>
        <div className="rounded border border-slate-300 bg-white px-3 py-2 text-sm">
          <span className="font-semibold text-slate-800">{lanes.length}</span>
          <span className="text-slate-700"> total lanes</span>
        </div>
      </section>

      <div className="space-y-6">
        {tracks.map((track) => {
          const lanesInTrack = lanes.filter((l) => trackForLane(l.lane) === track);
          if (lanesInTrack.length === 0) return null;
          const activeInTrack = lanesInTrack.filter((l) => ACTIVE_STATES.has(l.currentState)).length;
          return (
            <section key={track}>
              <h2 className="text-sm font-semibold text-slate-700 mb-2">
                {TRACK_LABELS[track]}
                <span className="ml-2 text-xs font-normal text-slate-400">
                  {activeInTrack > 0 ? `${activeInTrack} running` : "no active lane"}
                </span>
              </h2>
              <ul className="rounded border divide-y divide-slate-200 bg-white">
                {lanesInTrack.map((lane) => {
                  const last = lane.timeline[lane.timeline.length - 1];
                  return (
                    <li key={lane.lane} className="flex items-center gap-3 px-3 py-2 text-sm">
                      <LiveDot state={lane.currentState} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-900">{lane.lane}</span>
                          <span
                            className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                              STATE_CLASSES[lane.currentState] ?? "bg-slate-100 text-slate-700"
                            }`}
                          >
                            {lane.currentState}
                          </span>
                          {lane.currentState === "WAITING_ON" && lane.prerequisite && (
                            <span className="text-xs text-amber-800">
                              wait: {lane.prerequisite}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 truncate">{lane.task}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs text-slate-400">
                          {last?.time?.slice(0, 10) ?? "-"}
                        </p>
                        <p className="text-xs text-slate-500 max-w-[220px] truncate">
                          {last?.summary ?? ""}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      {lanes.length === 0 && !error && (
        <p className="text-sm text-slate-500">no lanes in the journal yet.</p>
      )}
    </main>
  );
}