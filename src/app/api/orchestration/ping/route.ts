import { NextResponse } from "next/server";

import { writePing } from "@/lib/orchestration-notes";
import { isLaneId } from "@/lib/orchestration-state";

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
 * Board refresh button: drops a pending-report request file for one board
 * seat ("master" or a lane id). The seat's lane-report hook surfaces the
 * ping on its next prompt and clears it once the matching report is posted.
 * Loopback-only, like every other orchestration surface.
 */
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  if ((origin && !loopbackOrigin(origin)) || (!origin && referer && !loopbackOrigin(referer))) {
    return NextResponse.json(
      { schemaVersion: 1, result: null, error: { code: "foreign_origin", status: 403 } },
      { status: 403 },
    );
  }
  const body = (await request.json().catch(() => ({}))) as { target?: unknown };
  const target = body.target;
  const seat =
    target === "master" || (typeof target === "string" && isLaneId(target)) ? target : null;
  if (!seat) {
    return NextResponse.json(
      { schemaVersion: 1, result: null, error: { code: "invalid_target", status: 422 } },
      { status: 422 },
    );
  }
  const ping = writePing(seat);
  return NextResponse.json(
    { schemaVersion: 1, result: { ping }, error: null },
    { status: 201 },
  );
}
