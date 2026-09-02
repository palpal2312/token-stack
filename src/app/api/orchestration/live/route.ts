import { NextResponse } from "next/server";

import { deriveOrcaLiveBoard } from "@/lib/orca-live";

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
 * Live Orca structure surface, localhost-only and read-only: child worktrees
 * as lanes, their tabs as sub-lanes, with the task currently dispatched to
 * each tab. Data comes from the Orca CLI; `?scope=<repoId>` selects the repo
 * (default: the repo of the worktree serving this dashboard).
 */
export async function GET(request: Request) {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
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

  const scope = new URL(request.url).searchParams.get("scope");
  try {
    const board = await deriveOrcaLiveBoard(scope);
    return NextResponse.json({
      schemaVersion: 1,
      requestId: crypto.randomUUID(),
      result: board,
      error: null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        schemaVersion: 1,
        requestId: crypto.randomUUID(),
        result: null,
        error: { code: "orca_unavailable", status: 502, message: (error as Error).message },
      },
      { status: 502 },
    );
  }
}
