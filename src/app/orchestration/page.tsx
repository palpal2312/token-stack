"use client";

import { useEffect, useState } from "react";

import {
  deriveCardStatus,
  laneCounters,
  trackForLane,
} from "@/lib/orchestration-board";
import type { BoardTrack } from "@/lib/orchestration-board";
import type { MasterNote } from "@/lib/orchestration-notes";
import type { OrchestrationLaneView } from "@/lib/orchestration-state";

interface ApiEnvelope {
  result: {
    lanes: OrchestrationLaneView[];
    generatedAt: string;
    sprint?: { total: number; closed: number; doing: number; current: number | null } | null;
    notes?: MasterNote[];
  } | null;
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

const LANE_ID_SET = new Set(Object.values(LANE_IDS));

/** Status colors from the Midnight Aubergine tokens (dark app theme). */
const STATUS_STYLE: Record<string, string> = {
  WORKING: "text-[var(--emerald)]",
  ACTIVE: "text-[var(--gold)]",
  DONE: "text-[var(--emerald)]",
  IDLE: "text-[var(--cream-mute)]",
  IDLE_WITH_WORK: "text-[var(--rust)]",
  HOLD_INTERNAL: "text-[var(--rust)]",
  HOLD_LANE: "text-[var(--gold)]",
  HOLD_APPROVAL: "text-[var(--plum)]",
  HOLD_TIME: "text-[var(--cream-dim)]",
};

type NoteField = "situation" | "close";

const NOTE_FIELDS: { key: NoteField; label: string; placeholder: string }[] = [
  {
    key: "situation",
    label: "CURRENTLY SITUATION",
    placeholder: "(master agent will fill this)",
  },
  {
    key: "close",
    label: "HOW TO CLOSE THIS SPRINT",
    placeholder: "(master agent will fill this)",
  },
];

export default function OrchestrationPage() {
  const [lanes, setLanes] = useState<OrchestrationLaneView[]>([]);
  const [sprint, setSprint] = useState<NonNullable<ApiEnvelope["result"]>["sprint"]>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<MasterNote[]>([]);

  // Single GET: lanes + sprint roadmap + master notes come back together.
  useEffect(() => {
    fetch("/api/orchestration/state")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((envelope: ApiEnvelope) => {
        if (envelope.error || !envelope.result) {
          setError(envelope.error?.code ?? "no result");
          return;
        }
        setLanes(envelope.result.lanes);
        setSprint(envelope.result.sprint ?? null);
        setNotes(envelope.result.notes ?? []);
        setGeneratedAt(envelope.result.generatedAt);
      })
      .catch((reason: unknown) => setError(String((reason as Error).message ?? reason)));
  }, []);

  const tracks: BoardTrack[] = ["A", "B", "C"];

  // MASTER card: roadmap + lane counters derived from the journal.
  const taskLanes = lanes.filter((l) => !LANE_ID_SET.has(l.lane));
  const counter = laneCounters(taskLanes.map((l) => l.currentState));
  const lifecycleStates = tracks.map(
    (track) => lanes.find((l) => l.lane === LANE_IDS[track])?.currentState,
  );
  // WORKING = running a task. ACTIVE = lane alive and answering when called —
  // any reported lifecycle state except IDLE (DISPATCHED/RUNNING/HOLD/DONE).
  const laneWorking = lifecycleStates.filter((s) => s === "RUNNING").length;
  const laneActive = lifecycleStates.filter((s) => s && s !== "IDLE").length;

  // Roadmap counts sprints from Orca run-manifests; falls back to journal task counters.
  const roadmap = sprint
    ? {
        doing: sprint.doing,
        done: sprint.closed,
        total: sprint.total,
        doingLabel:
          sprint.current === null
            ? "currently doing: none"
            : `Currently doing: Sprint ${String(sprint.current).padStart(2, "0")}`,
      }
    : {
        doing: counter.active,
        done: counter.done,
        total: taskLanes.length,
        doingLabel: "currently doing (journal tasks)",
      };

  const latestNote = (field: NoteField): MasterNote | undefined =>
    [...notes].reverse().find((n) => (n.field ?? "situation") === field);

  return (
    <main className="p-6 max-w-4xl mx-auto text-[var(--cream)]">
      <header className="mb-5">
        <h1 className="text-xl font-semibold text-[var(--cream)]">Orca lanes</h1>
        <p className="text-sm text-[var(--cream-dim)]">
          {generatedAt ? `journal snapshot ${generatedAt}` : "loading…"}
        </p>
      </header>

      {error && <p className="text-[var(--plum)] mb-4">failed to load state: {error}</p>}

      {/* MASTER card — sprint rollup + master-written directives */}
      <section className="rounded border border-[var(--line)] bg-[var(--bg-card)] shadow p-5 mb-6">
        <h2 className="text-lg font-bold text-center mb-4 text-[var(--gold)]">MASTER</h2>
        <div className="space-y-3 text-sm">
          <p>
            <span className="font-semibold text-[var(--gold-soft)]">ROAD MAP - SPRINT:</span>{" "}
            {roadmap.doing} ({roadmap.doingLabel}) / {roadmap.done} (done) /{" "}
            {roadmap.total} (total)
          </p>
          <p>
            <span className="font-semibold text-[var(--gold-soft)]">LANE:</span> {laneWorking} (working) |{" "}
            {laneActive} (active) | {tracks.length} (total)
          </p>
          {NOTE_FIELDS.map((field) => {
            const note = latestNote(field.key);
            return (
              <div
                key={field.key}
                className="rounded border border-[var(--line)] bg-[var(--bg-mid)] px-3 py-2"
              >
                <div className="font-semibold text-[var(--gold-soft)]">{field.label}:</div>
                <div className="mt-1 text-[var(--cream)]">
                  {note ? (
                    <span>{note.text}</span>
                  ) : (
                    <span className="italic text-[var(--cream-mute)]">{field.placeholder}</span>
                  )}
                  {note && (
                    <span className="text-xs text-[var(--cream-mute)] ml-2">
                      {note.time?.slice(0, 16).replace("T", " ")}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="border border-[var(--plum)] bg-[var(--bg-card)] text-[var(--plum)] rounded px-3 py-2 text-sm mb-6">
        READ-ONLY ORCHESTRATION STATE — no execution authority. This page reads
        the append-only state journal; it cannot dispatch, promote, or write.
        legacy_writer: disabled; phase_21: blocked.
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {tracks.map((track) => {
          const laneId = LANE_IDS[track];
          const lifecycleEvent = lanes.find((l) => l.lane === laneId);
          const trackTaskLanes = lanes.filter(
            (l) => l.lane !== laneId && trackForLane(l.lane) === track,
          );
          const counters = laneCounters(trackTaskLanes.map((l) => l.currentState));
          const status = deriveCardStatus(counters, lifecycleEvent?.currentState);
          const holdDetail = lifecycleEvent?.prerequisite;
          // Lane memo = summary of the lane's latest lifecycle event.
          const laneNote = lifecycleEvent?.timeline[lifecycleEvent.timeline.length - 1]?.summary;

          return (
            <div
              key={track}
              className="rounded border border-[var(--line)] bg-[var(--bg-card)] shadow p-5 flex flex-col gap-3"
            >
              <div className="text-sm font-semibold text-[var(--cream-soft)]">{TRACK_LABELS[track]}</div>
              <div className={`text-2xl font-bold ${STATUS_STYLE[status] ?? "text-[var(--cream)]"}`}>
                {status}
              </div>
              {status.startsWith("HOLD_") && holdDetail && (
                <div className="text-xs bg-[var(--bg-mid)] rounded px-2 py-1 text-[var(--cream-dim)]">
                  {status === "HOLD_LANE" && `waiting on: ${holdDetail}`}
                  {status === "HOLD_APPROVAL" && `approval needed: ${holdDetail}`}
                  {status === "HOLD_TIME" && `resume: ${holdDetail}`}
                  {status === "HOLD_INTERNAL" && `lane issue: ${holdDetail}`}
                </div>
              )}
              {laneNote && (
                <div className="text-xs italic text-[var(--cream-dim)]" title={lifecycleEvent?.lastEventAt}>
                  {laneNote}
                </div>
              )}

              {/* Task counters: finished / running / queued */}
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded bg-[var(--bg-mid)] border border-[var(--line-deep)] px-2 py-1">
                  <div className="text-lg font-bold text-[var(--emerald)]">{counters.done}</div>
                  <div className="text-[11px] text-[var(--cream-dim)]">done</div>
                </div>
                <div className="rounded bg-[var(--bg-mid)] border border-[var(--line-deep)] px-2 py-1">
                  <div className="text-lg font-bold text-[var(--gold)]">{counters.active}</div>
                  <div className="text-[11px] text-[var(--cream-dim)]">active</div>
                </div>
                <div className="rounded bg-[var(--bg-mid)] border border-[var(--line-deep)] px-2 py-1">
                  <div className="text-lg font-bold text-[var(--rust)]">{counters.pending}</div>
                  <div className="text-[11px] text-[var(--cream-dim)]">pending</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {lanes.length === 0 && !error && (
        <p className="text-sm text-[var(--cream-dim)] mt-6">no lanes in the journal yet.</p>
      )}
    </main>
  );
}
