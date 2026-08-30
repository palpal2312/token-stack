import { NextResponse } from "next/server";

import { deriveBoardCards } from "@/lib/orchestration-board";
import { readNotes } from "@/lib/orchestration-notes";
import { deriveSprintRoadmap, OrchestrationStateStore } from "@/lib/orchestration-state";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function loopbackOrigin(raw: string | null): boolean {
  if (!raw) return false;
  try {
    return LOOPBACK_HOSTS.has(new URL(raw).hostname);
  } catch {
    return false;
  }
}

/**
 * Read-only orchestration-state surface, localhost-only. Serves the append-only
 * journal as an envelope ({schemaVersion, requestId, result, error}) plus a
 * derived per-lane view. Never writes. Origin/referer are checked against
 * loopback hosts; a cross-origin page cannot read it.
 */
export async function GET(request: Request) {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  // A present Origin must be ours; a foreign one (or a foreign Referer when
  // Origin is absent) is refused.
  if ((origin && !loopbackOrigin(origin)) || (!origin && referer && !loopbackOrigin(referer))) {
    return NextResponse.json(
      {
        schemaVersion: 1,
        requestId: crypto.randomUUID(),
        result: null,
        error: { code: "foreign_origin", status: 403 },
      },
      { status: 403 },
    );
  }

  const store = new OrchestrationStateStore();
  const events = store.readEvents();
  const lanes = store.deriveLanes();
  const notes = readNotes();

  // Roadmap + cards derive together so the cards track the current sprint.
  const sprint = deriveSprintRoadmap();
  const cards = deriveBoardCards(lanes, notes, {
    currentSprint: sprint?.current ?? null,
  });

  // Last write across both journals: who appended most recently, and where.
  let lastWrite: { time: string; writer: string; kind: "event" | "note" } | null = null;
  for (const e of events) {
    if (!e.time) continue;
    if (!lastWrite || e.time > lastWrite.time) {
      // Legacy rows predate the writer field; attribute them to the
      // reporting lane (the controller was only the scribe).
      lastWrite = { time: e.time, writer: e.writer ?? e.lane, kind: "event" };
    }
  }
  for (const n of notes) {
    if (!n.time) continue;
    if (!lastWrite || n.time > lastWrite.time) {
      lastWrite = { time: n.time, writer: n.writer ?? "master", kind: "note" };
    }
  }

  // ?compact=1: token-cheap summary for machine readers — short keys, no raw
  // events/timelines/note history. ?compact=state: state-only ultra-cheap
  // polling, no message text at all. Clocks are HH:mm:ss UTC slices.
  const compact = new URL(request.url).searchParams.get("compact");
  if (compact !== null) {
    if (compact === "state") {
      return NextResponse.json({
        schemaVersion: 1,
        result: {
          at: new Date().toISOString(),
          lw: lastWrite && {
            w: lastWrite.writer,
            k: lastWrite.kind,
            t: lastWrite.time.slice(11, 19),
          },
          sprint,
          cards: cards.map((c) => ({
            t: c.track,
            s: c.status,
            d: c.counters.done,
            a: c.counters.active,
            p: c.counters.pending,
            lc: c.lifecycle ?? null,
            pr: c.prerequisite ?? null,
            w: c.lastWrite?.writer ?? null,
            lt: c.lastWrite?.time?.slice(11, 19) ?? null,
          })),
        },
        error: null,
      });
    }
    const latestText = (field: string) =>
      [...notes].reverse().find((n) => (n.field ?? "situation") === field)?.text ?? null;
    return NextResponse.json({
      schemaVersion: 1,
      result: {
        at: new Date().toISOString(),
        lw: lastWrite && {
          w: lastWrite.writer,
          k: lastWrite.kind,
          t: lastWrite.time.slice(11, 19),
        },
        sprint,
        situation: latestText("situation"),
        close: latestText("close"),
        cards: cards.map((c) => ({
          t: c.track,
          s: c.status,
          d: c.counters.done,
          a: c.counters.active,
          p: c.counters.pending,
          m: c.memo ?? null,
          run: c.run ?? null,
          next: c.next ?? null,
          w: c.lastWrite?.writer ?? null,
          lt: c.lastWrite?.time?.slice(11, 19) ?? null,
        })),
      },
      error: null,
    });
  }

  return NextResponse.json({
    schemaVersion: 1,
    requestId: crypto.randomUUID(),
    result: {
      lanes,
      events,
      // Derived lane cards — the same projection the dashboard renders, so a
      // machine reader (master agent) gets status/counters/notes in one GET.
      cards,
      sprint,
      notes,
      lastWrite,
      generatedAt: new Date().toISOString(),
    },
    error: null,
  });
}