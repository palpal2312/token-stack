import { NextResponse } from "next/server";

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

  return NextResponse.json({
    schemaVersion: 1,
    requestId: crypto.randomUUID(),
    result: {
      lanes,
      events,
      sprint: deriveSprintRoadmap(),
      notes,
      lastWrite,
      generatedAt: new Date().toISOString(),
    },
    error: null,
  });
}