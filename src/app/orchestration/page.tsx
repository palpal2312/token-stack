"use client";

import { useEffect, useState } from "react";

import {
  BOARD_COLUMNS,
  BoardColumn,
  BoardTrack,
  columnForState,
  trackForLane,
} from "@/lib/orchestration-state";
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
  task: string;
  transition: string;
  time?: string;
  prerequisite?: string;
  evidencePath?: string;
  evidenceSha256?: string;
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
  A: "Lane A — community intake + snapshot return",
  B: "Lane B — controlled delivery",
  C: "Lane C — integration / governance",
};

const COLUMN_LABELS: Record<BoardColumn, string> = {
  todo: "To Do",
  "in-progress": "In Progress",
  done: "Done",
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
  const byTrack = (track: BoardTrack) =>
    lanes.filter((l) => trackForLane(l.lane) === track);
  const inColumn = (track: BoardTrack, column: BoardColumn) =>
    byTrack(track).filter((l) => columnForState(l.currentState) === column);

  return (
    <main className="p-6 max-w-6xl mx-auto">
      <div className="border-2 border-rose-400 bg-rose-50 text-rose-800 rounded px-3 py-2 text-sm mb-6">
        READ-ONLY ORCHESTRATION STATE — no execution authority. This dashboard
        renders the append-only state journal; it cannot dispatch, promote, or
        write. legacy_writer: disabled; phase_21: blocked.
      </div>
      <header className="mb-6">
        <h1 className="text-xl font-semibold">Orchestration state — Sprint 09 lanes</h1>
        <p className="text-sm text-slate-500">
          {generatedAt ? `journal snapshot ${generatedAt}` : "loading…"}
        </p>
      </header>

      {error && <p className="text-rose-700 mb-4">failed to load state: {error}</p>}

      <div className="space-y-6">
        {tracks.map((track) => (
          <section key={track}>
            <h2 className="text-base font-semibold mb-2">{TRACK_LABELS[track]}</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {BOARD_COLUMNS.map((column) => {
                const cards = inColumn(track, column);
                return (
                  <div
                    key={column}
                    className="rounded border bg-slate-50 p-3 min-h-[120px]"
                  >
                    <h3 className="text-xs font-medium text-slate-400 mb-2">
                      {COLUMN_LABELS[column]} ({cards.length})
                    </h3>
                    <div className="space-y-3">
                      {cards.map((lane) => (
                        <article
                          key={lane.lane}
                          className="border rounded p-3 bg-white shadow-sm"
                        >
                          <div className="flex items-center justify-between mb-1">
                            <h4 className="text-sm font-semibold">{lane.lane}</h4>
                            <span
                              className={`text-xs font-medium px-2 py-0.5 rounded ${
                                STATE_CLASSES[lane.currentState] ?? "bg-slate-100 text-slate-700"
                              }`}
                            >
                              {lane.currentState}
                            </span>
                          </div>
                          <p className="text-xs text-slate-600 mb-1">{lane.task}</p>
                          {lane.currentState === "WAITING_ON" && lane.prerequisite && (
                            <p className="text-xs text-amber-800 mb-1">
                              prerequisite: {lane.prerequisite}
                            </p>
                          )}
                          {lane.evidence && (
                            <p className="text-xs mb-1">
                              <a
                                className="underline break-all text-blue-700"
                                href={lane.evidence.path}
                              >
                                {lane.evidence.path}
                              </a>
                              <span className="text-slate-400"> {lane.evidence.sha256.slice(0, 8)}…</span>
                            </p>
                          )}
                          <details className="text-xs mt-1">
                            <summary className="text-slate-400 cursor-pointer">
                              timeline ({lane.timeline.length})
                            </summary>
                            <ol className="mt-1 space-y-1">
                              {[...lane.timeline].reverse().map((e, index) => (
                                <li
                                  key={`${e.lane}-${e.time}-${index}`}
                                  className="flex gap-2 text-xs"
                                >
                                  <span className="text-slate-400 shrink-0">
                                    {e.time?.slice(11, 19) ?? e.time}
                                  </span>
                                  <span className="font-medium shrink-0">{e.transition}</span>
                                  <span className="text-slate-600">{e.summary}</span>
                                </li>
                              ))}
                            </ol>
                          </details>
                        </article>
                      ))}
                      {cards.length === 0 && (
                        <p className="text-xs text-slate-300">—</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      {lanes.length === 0 && !error && (
        <p className="text-sm text-slate-500">no lanes in the journal yet.</p>
      )}
    </main>
  );
}