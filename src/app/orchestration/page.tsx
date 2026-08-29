"use client";

import { useEffect, useState } from "react";

import type { OrchestrationEvent, OrchestrationLaneView } from "@/lib/orchestration-state";

interface ApiEnvelope {
  result: {
    lanes: OrchestrationLaneView[];
    events: OrchestrationEvent[];
    generatedAt: string;
  } | null;
  error: { code: string; status: number } | null;
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

  const waiting = lanes.filter((l) => l.currentState === "WAITING_ON");

  return (
    <main className="p-6 max-w-5xl mx-auto">
      <div className="border-2 border-rose-400 bg-rose-50 text-rose-800 rounded px-3 py-2 text-sm mb-6">
        READ-ONLY ORCHESTRATION STATE — no execution authority. This dashboard
        renders the append-only state journal; it cannot dispatch, promote, or
        write. legacy_writer: disabled; phase_21: blocked.
      </div>
      <header className="mb-6">
        <h1 className="text-xl font-semibold">Orchestration state</h1>
        <p className="text-sm text-slate-500">
          {generatedAt ? `journal snapshot ${generatedAt}` : "loading…"}
        </p>
      </header>

      {error && (
        <p className="text-rose-700 mb-4">failed to load state: {error}</p>
      )}

      {waiting.length > 0 && (
        <section className="mb-6">
          <h2 className="text-sm font-medium text-amber-800 mb-2">Waiting / dependencies</h2>
          <ul className="space-y-1">
            {waiting.map((l) => (
              <li key={l.lane} className="text-sm bg-amber-50 border border-amber-200 rounded px-3 py-2">
                {l.lane} (<b>{l.task}</b>) waiting on: {l.prerequisite ?? "unknown prerequisite"}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {lanes.map((lane) => (
          <article key={lane.lane} className="border rounded p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-base font-semibold">{lane.lane}</h2>
              <span
                className={`text-xs font-medium px-2 py-1 rounded ${
                  STATE_CLASSES[lane.currentState] ?? "bg-slate-100 text-slate-700"
                }`}
              >
                {lane.currentState}
              </span>
            </div>
            <p className="text-sm text-slate-600 mb-2">{lane.task}</p>
            {lane.currentState === "WAITING_ON" && lane.prerequisite && (
              <p className="text-xs text-amber-800 mb-2">prerequisite: {lane.prerequisite}</p>
            )}
            {lane.evidence && (
              <p className="text-xs mb-2">
                evidence{" "}
                <a className="underline text-blue-700" href={lane.evidence.path}>
                  {lane.evidence.path}
                </a>{" "}
                <code className="text-slate-500">{lane.evidence.sha256.slice(0, 12)}…</code>
              </p>
            )}

            <h3 className="text-xs font-medium text-slate-400 mb-1 mt-3">timeline</h3>
            <ol className="space-y-1 text-sm">
              {[...lane.timeline].reverse().map((e, index) => (
                <li key={`${e.lane}-${e.time}-${index}`} className="flex gap-2">
                  <span className="text-slate-400 shrink-0">{e.time?.slice(11, 19) ?? e.time}</span>
                  <span className="font-medium shrink-0 text-slate-700">{e.transition}</span>
                  <span className="text-slate-600">{e.summary}</span>
                </li>
              ))}
            </ol>
          </article>
        ))}
      </div>
      {lanes.length === 0 && !error && (
        <p className="text-sm text-slate-500">no lanes in the journal yet.</p>
      )}
    </main>
  );
}