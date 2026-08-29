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

  return NextResponse.json({
    schemaVersion: 1,
    requestId: crypto.randomUUID(),
    result: {
      lanes,
      events,
      sprint: deriveSprintRoadmap(),
      notes: readNotes(),
      generatedAt: new Date().toISOString(),
    },
    error: null,
  });
}