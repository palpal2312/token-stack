"use client";

import { useEffect, useState } from "react";

import { isLifecycleLaneId, laneCounters } from "@/lib/orchestration-board";
import type { BoardCard } from "@/lib/orchestration-board";
import type { MasterNote } from "@/lib/orchestration-notes";
import type { OrchestrationLaneView } from "@/lib/orchestration-state";
import type { OrcaLiveBoard, LiveSubLane } from "@/lib/orca-live";

interface ApiEnvelope {
  result: {
    lanes: OrchestrationLaneView[];
    cards?: BoardCard[];
    generatedAt: string;
    sprint?: { total: number; closed: number; doing: number; current: number | null } | null;
    notes?: MasterNote[];
    lastWrite?: { time: string; writer: string; kind: "event" | "note" } | null;
  } | null;
  error: { code: string; status: number } | null;
}

interface LiveEnvelope {
  result: OrcaLiveBoard | null;
  error: { code: string; status: number; message?: string } | null;
}

/** Dispatch status colors for sub-lane task chips. */
const DISPATCH_STYLE: Record<string, string> = {
  running: "text-[var(--emerald)]",
  ready: "text-[var(--emerald)]",
  completed: "text-[var(--cream-dim)]",
  failed: "text-[var(--rust)]",
};

/** Child lane card status colors (Midnight Aubergine tokens). */
const LANE_STATUS_STYLE: Record<string, string> = {
  WORKING: "text-[var(--emerald)]",
  ACTIVE: "text-[var(--gold)]",
  IDLE: "text-[var(--cream-mute)]",
};

// Lane card note boxes, filled by the lane agent via the note API (run/next + lane).
const LANE_NOTE_FIELDS: { key: "run" | "next"; label: string; placeholder: string }[] = [
  {
    key: "run",
    label: "Last run journal",
    placeholder: "(lane agent will fill this)",
  },
  {
    key: "next",
    label: "Next action / Block",
    placeholder: "(lane agent will fill this)",
  },
];

type NoteField = "situation" | "close" | "run" | "next";

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

// Every clock on the board renders in GMT+7 (Ho Chi Minh City) no matter which
// UTC instant a writer stamped — one shared timezone for every reader.
const BOARD_TZ = "Asia/Ho_Chi_Minh";
const clock = (d: Date): string =>
  d.toLocaleTimeString("en-GB", { timeZone: BOARD_TZ, hour12: false });
/** HH:mm:ss +07 — last-write lines. */
const fmtTime = (time?: string): string =>
  time ? `${clock(new Date(time))} +07` : "";
/** YYYY-MM-DD HH:mm +07 — note box stamps. */
const fmtStamp = (time?: string): string | undefined => {
  if (!time) return undefined;
  const d = new Date(time);
  return `${d.toLocaleDateString("en-CA", { timeZone: BOARD_TZ })} ${clock(d).slice(0, 5)} +07`;
};
/** YYYY-MM-DD HH:mm:ss +07 — header snapshot. */
const fmtFull = (time?: string): string => {
  if (!time) return "";
  const d = new Date(time);
  return `${d.toLocaleDateString("en-CA", { timeZone: BOARD_TZ })} ${clock(d)} +07`;
};

/** One tab rendered as a full lane-style card: title, status, memo, counters. */
function TabCard({
  sub,
  notes,
  pinned,
  declared,
  onTogglePin,
}: {
  sub: LiveSubLane;
  notes: MasterNote[];
  /** Manual pin (user) or auto main (server) — sticky first on the row. */
  pinned: "manual" | "auto" | null;
  /** The master agent named this tab's terminal handle in a note. */
  declared: boolean;
  onTogglePin: () => void;
}) {
  // WORKING = dispatch running on this tab; ACTIVE = tab open; IDLE = closed.
  const status =
    sub.task && (sub.task.status === "running" || sub.task.status === "ready")
      ? "WORKING"
      : sub.active
        ? "ACTIVE"
        : "IDLE";
  const counters = {
    done: sub.task?.status === "completed" ? 1 : 0,
    active: status === "WORKING" ? 1 : 0,
    pending:
      sub.task && sub.task.status !== "completed" && status !== "WORKING" ? 1 : 0,
  };
  // Settled dispatch (completed/failed) but tab still open = zombie awaiting
  // worker-release; dim the card so unreleased zombies stand out.
  const settled =
    sub.task !== undefined &&
    sub.task.status !== "running" &&
    sub.task.status !== "ready";
  return (
    <div
      className={`w-72 shrink-0 rounded border bg-[var(--bg-card)] shadow p-5 flex flex-col gap-3 ${
        pinned || sub.coordinator ? "border-[var(--gold)]" : "border-[var(--line)]"
      } ${pinned ? "sticky left-0 z-10" : ""} ${settled ? "opacity-60" : ""}`}
    >
      <div className="flex items-start gap-2">
        <div className="text-sm font-semibold text-[var(--cream-soft)] truncate flex-1" title={sub.title}>
          {sub.kind === "browser" ? "🌐 " : "⌨ "}
          {sub.title}
        </div>
        <button
          type="button"
          onClick={onTogglePin}
          title={pinned === "manual" ? "Unpin this tab" : "Pin this tab first"}
          className={`shrink-0 text-sm leading-none transition ${
            pinned === "manual"
              ? "text-[var(--gold)]"
              : "text-[var(--cream-mute)] opacity-40 hover:opacity-100"
          }`}
        >
          📌
        </button>
      </div>
      {/* Badges get their own row so they never squeeze the title. */}
      {(pinned || sub.coordinator || sub.focused || declared || sub.live ||
        (sub.task && (sub.task.status === "running" || sub.task.status === "ready"))) && (
        <div className="flex flex-wrap gap-1 -mt-1">
          {pinned && (
            <span className="text-[10px] uppercase tracking-wide text-[var(--gold)] border border-[var(--gold)] rounded px-1">
              📌 {pinned === "manual" ? "pinned" : "main"}
            </span>
          )}
          {sub.coordinator && (
            <span className="text-[10px] uppercase tracking-wide text-[var(--gold)] border border-[var(--gold)] rounded px-1">
              coordinator
            </span>
          )}
          {sub.focused && (
            <span className="text-[10px] uppercase tracking-wide text-[var(--emerald)] border border-[var(--emerald)] rounded px-1">
              ▶ focus
            </span>
          )}
          {declared && (
            <span className="text-[10px] uppercase tracking-wide text-[var(--plum)] border border-[var(--plum)] rounded px-1">
              ★ declared
            </span>
          )}
          {sub.task && (sub.task.status === "running" || sub.task.status === "ready") && (
            <span className="text-[10px] uppercase tracking-wide text-[var(--gold)] border border-[var(--gold)] rounded px-1">
              ⚙ worker
            </span>
          )}
          {sub.live && (
            <span className="text-[10px] uppercase tracking-wide text-[var(--emerald)] border border-[var(--emerald)] rounded px-1">
              ● live
            </span>
          )}
        </div>
      )}
      <div className={`text-2xl font-bold ${LANE_STATUS_STYLE[status] ?? "text-[var(--cream)]"}`}>
        {status}
      </div>
      {/* Fixed two-line slot keeps cards row-aligned. */}
      <div className="text-xs italic text-[var(--cream-dim)] line-clamp-2 min-h-8" title={sub.memo}>
        {sub.memo}
      </div>

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

      {sub.task && (
        <div
          className="rounded border border-[var(--line)] bg-[var(--bg-mid)] px-3 py-2 text-xs"
          title={`${sub.task.id} · run ${sub.task.runId}`}
        >
          <span className="text-[var(--gold-soft)]">dispatch: </span>
          <span className="text-[var(--cream)]">{sub.task.title}</span>{" "}
          <span className={DISPATCH_STYLE[sub.task.status] ?? "text-[var(--cream-dim)]"}>
            ({sub.task.status})
          </span>
        </div>
      )}

      {LANE_NOTE_FIELDS.map((field) => {
        const note = [...notes]
          .reverse()
          .find((n) => n.lane === sub.title && n.field === field.key);
        return (
          <div
            key={field.key}
            className="rounded border border-[var(--line)] bg-[var(--bg-mid)] px-3 py-2"
          >
            <div className="text-xs font-semibold text-[var(--gold-soft)]">{field.label}:</div>
            <div className="mt-1 text-xs text-[var(--cream)] line-clamp-2 min-h-8" title={note?.text}>
              {note ? (
                <span>{note.text}</span>
              ) : (
                <span className="italic text-[var(--cream-mute)]">{field.placeholder}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function OrchestrationPage() {
  const [lanes, setLanes] = useState<OrchestrationLaneView[]>([]);
  const [cards, setCards] = useState<BoardCard[]>([]);
  const [sprint, setSprint] = useState<NonNullable<ApiEnvelope["result"]>["sprint"]>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<MasterNote[]>([]);
  const [lastWrite, setLastWrite] = useState<NonNullable<ApiEnvelope["result"]>["lastWrite"]>(null);
  const [live, setLive] = useState<OrcaLiveBoard | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [scope, setScope] = useState<string | null>(null);
  // Manual tab pins per lane (lane worktreeId, "__primary__" for master).
  // A manual pin overrides the server's auto main; unpin reverts to auto.
  const [pins, setPins] = useState<Record<string, string>>({});
  useEffect(() => {
    try {
      setPins(JSON.parse(localStorage.getItem("orchestration.tabPins") ?? "{}"));
    } catch {
      /* corrupt pin store: start empty */
    }
  }, []);
  const togglePin = (laneKey: string, subId: string) => {
    setPins((prev) => {
      const next = { ...prev };
      if (next[laneKey] === subId) delete next[laneKey];
      else next[laneKey] = subId;
      try {
        localStorage.setItem("orchestration.tabPins", JSON.stringify(next));
      } catch {
        /* storage full/blocked: pins live only for this session */
      }
      return next;
    });
  };
  const rowSubs = (laneKey: string, subs: LiveSubLane[]) => {
    const manualId = pins[laneKey];
    const pinOf = (s: LiveSubLane): "manual" | "auto" | null =>
      manualId ? (s.id === manualId ? "manual" : null) : s.main ? "auto" : null;
    return [...subs]
      .sort((a, b) => Number(!!pinOf(b)) - Number(!!pinOf(a)))
      .map((sub) => (
        <TabCard
          key={sub.id}
          sub={sub}
          notes={notes}
          pinned={pinOf(sub)}
          declared={sub.id === declaredHandle}
          onTogglePin={() => togglePin(laneKey, sub.id)}
        />
      ));
  };

  // Live Orca structure: children = lanes, their tabs = sub-lanes. Polls on
  // its own cadence since dispatches move faster than the journal.
  const loadLive = (scopeId: string | null) => {
    const query = scopeId ? `?scope=${encodeURIComponent(scopeId)}` : "";
    fetch(`/api/orchestration/live${query}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((envelope: LiveEnvelope) => {
        if (envelope.error || !envelope.result) {
          setLiveError(envelope.error?.message ?? envelope.error?.code ?? "no result");
          return;
        }
        setLive(envelope.result);
        setLiveError(null);
      })
      .catch((reason: unknown) => setLiveError(String((reason as Error).message ?? reason)));
  };
  useEffect(() => {
    loadLive(scope);
    const timer = setInterval(() => loadLive(scope), 15_000);
    return () => clearInterval(timer);
  }, [scope]);

  // Single GET: lanes + derived cards + sprint roadmap + notes come back together.
  const load = () => {
    fetch("/api/orchestration/state")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((envelope: ApiEnvelope) => {
        if (envelope.error || !envelope.result) {
          setError(envelope.error?.code ?? "no result");
          return;
        }
        setLanes(envelope.result.lanes);
        setCards(envelope.result.cards ?? []);
        setSprint(envelope.result.sprint ?? null);
        setNotes(envelope.result.notes ?? []);
        setLastWrite(envelope.result.lastWrite ?? null);
        setGeneratedAt(envelope.result.generatedAt);
      })
      .catch((reason: unknown) => setError(String((reason as Error).message ?? reason)));
  };
  useEffect(load, []);

  // MASTER card: roadmap + lane counters derived from the journal.
  const taskLanes = lanes.filter((l) => !isLifecycleLaneId(l.lane));
  const counter = laneCounters(taskLanes.map((l) => l.currentState));
  // WORKING = running a task. ACTIVE = lane alive and answering when called —
  // any reported lifecycle state except IDLE (DISPATCHED/RUNNING/HOLD/DONE).
  const laneWorking = cards.filter((c) => c.lifecycle === "RUNNING").length;
  const laneActive = cards.filter((c) => c.lifecycle && c.lifecycle !== "IDLE").length;

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

  // The master agent declares its takeover tab by naming its terminal handle
  // (term_xxx) in a note — the exact tab then gets a DECLARED badge instead
  // of relying on title/focus inference.
  const declaredHandle = (() => {
    for (const n of [...notes].reverse()) {
      const m = /term_[0-9a-f-]{8,}/.exec(n.text);
      if (m) return m[0];
    }
    return null;
  })();

  // Most recent master note = last write shown on the MASTER card.
  const lastNote = notes.length > 0 ? notes[notes.length - 1] : undefined;

  return (
    <main className="p-6 max-w-4xl mx-auto text-[var(--cream)]">
      <header className="mb-5">
        <h1 className="text-xl font-semibold text-[var(--cream)]">Orca lanes</h1>
        <p className="text-sm text-[var(--cream-dim)]">
          {generatedAt ? `journal snapshot ${fmtFull(generatedAt)}` : "loading…"}
          {lastWrite && (
            <span className="text-[var(--cream-mute)]">
              {" · "}last write: {lastWrite.writer} ({lastWrite.kind}) {fmtTime(lastWrite.time)}
            </span>
          )}
        </p>
      </header>

      {error && <p className="text-[var(--plum)] mb-4">failed to load state: {error}</p>}

      {/* LIVE section — Orca children as lanes, their tabs as sub-lanes. */}
      <section className="mb-6">
        <div className="flex items-center gap-3 mb-3">
          <h2 className="text-lg font-bold text-[var(--gold)]">LIVE LANES</h2>
          {live && live.scopes.length > 0 && (
            <select
              className="text-xs bg-[var(--bg-mid)] border border-[var(--line)] rounded px-2 py-1 text-[var(--cream)]"
              value={scope ?? live.scope ?? ""}
              onChange={(e) => setScope(e.target.value || null)}
            >
              {live.groups.map((g) => (
                <optgroup key={g.id} label={g.label}>
                  {g.repos.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                      {s.id === live.scope && scope === null ? " (primary)" : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          )}
          {live && (
            <span className="text-xs text-[var(--cream-mute)]">
              snapshot {fmtTime(live.generatedAt)}
            </span>
          )}
        </div>
        {liveError && (
          <p className="text-[var(--plum)] text-sm mb-3">live lanes unavailable: {liveError}</p>
        )}
        {live?.degraded && live.degraded.length > 0 && (
          <p className="text-xs text-[var(--rust)] mb-3" title={live.degraded.join("\n")}>
            partial data: {live.degraded.join("; ")}
          </p>
        )}

        {/* MASTER card — the parent node: sprint rollup + master directives.
            Children cards hang underneath, mirroring the Orca sidebar tree. */}
        <section className="rounded border border-[var(--line)] bg-[var(--bg-card)] shadow p-5 mb-4">
          <h2 className="text-lg font-bold text-[var(--gold)] mb-4">MASTER</h2>
          <div className="space-y-3 text-sm">
            <p>
              <span className="font-semibold text-[var(--gold-soft)]">ROAD MAP - SPRINT:</span>{" "}
              {roadmap.doing} ({roadmap.doingLabel}) / {roadmap.done} (done) /{" "}
              {roadmap.total} (total)
            </p>
            <p>
              <span className="font-semibold text-[var(--gold-soft)]">LANE:</span> {laneWorking} (working) |{" "}
              {laneActive} (active) | {cards.length} (total)
            </p>
            <p>
              <span className="font-semibold text-[var(--gold-soft)]">CHILDREN:</span>{" "}
              {live ? live.lanes.length : "…"}
              {live?.primary && (
                <span className="text-[var(--cream-mute)]">
                  {" "}· of {live.primary.name} ({live.primary.branch})
                </span>
              )}
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
                        {fmtStamp(note.time)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
            {lastNote && (
              <div className="text-xs text-[var(--cream-mute)]">
                last write: {lastNote.writer ?? "master"} · {fmtTime(lastNote.time)}
              </div>
            )}

            {/* Master's own tabs — each tab is a card, same as children */}
            {live?.primary && live.primary.subLanes.length > 0 && (
              <div className="flex flex-col gap-2">
                <div className="text-xs font-semibold text-[var(--gold-soft)]">TABS:</div>
                <div className="flex gap-4 overflow-x-auto pb-2">
                  {rowSubs("__primary__", live.primary.subLanes)}
                </div>
              </div>
            )}
          </div>
        </section>
        <div className="flex flex-col gap-6 pl-6 border-l-2 border-[var(--line)]">
          {live?.lanes.map((lane) => (
            <div key={lane.worktreeId} className="flex flex-col gap-3">
              {/* Child header: identity + aggregate, the tab cards carry detail. */}
              <div className="rounded border border-[var(--line)] bg-[var(--bg-card)] shadow px-5 py-3 flex items-center gap-4 flex-wrap">
                <span className="text-sm font-semibold text-[var(--cream-soft)]">
                  {lane.name}{" "}
                  <span className="font-normal text-xs text-[var(--cream-mute)]">{lane.branch}</span>
                </span>
                <span className={`text-lg font-bold ${LANE_STATUS_STYLE[lane.status] ?? ""}`}>
                  {lane.status}
                </span>
                <span
                  className="text-xs italic text-[var(--cream-dim)] truncate flex-1 min-w-24"
                  title={lane.comment}
                >
                  {lane.comment}
                </span>
                <span className="text-xs text-[var(--cream-dim)]">
                  {lane.counters.done} done · {lane.counters.active} active · {lane.counters.pending} pending
                </span>
                {lane.activityAt && (
                  <span className="text-xs text-[var(--cream-mute)]">
                    last activity: {fmtTime(new Date(lane.activityAt).toISOString())}
                  </span>
                )}
              </div>

              {/* Every tab of this child is a card (sub-lane). */}
              {lane.subLanes.length === 0 ? (
                <p className="text-xs italic text-[var(--cream-mute)]">no open tabs</p>
              ) : (
                <div className="flex gap-4 overflow-x-auto pb-2 pl-6 border-l-2 border-[var(--line)]">
                  {rowSubs(lane.worktreeId, lane.subLanes)}
                </div>
              )}
            </div>
          ))}
        </div>
        {live && live.lanes.length === 0 && (
          <p className="text-sm text-[var(--cream-dim)]">no running children in this scope.</p>
        )}
      </section>

      <div className="border border-[var(--plum)] bg-[var(--bg-card)] text-[var(--plum)] rounded px-3 py-2 text-sm mb-6">
        READ-ONLY ORCHESTRATION STATE — no execution authority. This page reads
        the append-only state journal; it cannot dispatch, promote, or write.
        legacy_writer: disabled; phase_21: blocked.
      </div>
    </main>
  );
}
