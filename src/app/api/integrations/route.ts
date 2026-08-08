import { NextResponse } from "next/server";
import { statusAll, type IntegrationStatus } from "@/lib/integrations/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Probing spawns processes and opens sockets. The page polls, and several tabs
// may be open, so a short cache keeps a refresh cheap without ever showing
// yesterday's answer.
const TTL_MS = 10_000;
let cache: { at: number; rows: IntegrationStatus[] } | null = null;
let inFlight: Promise<IntegrationStatus[]> | null = null;

export async function GET(req: Request) {
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  const now = Date.now();

  if (!fresh && cache && now - cache.at < TTL_MS) {
    return NextResponse.json({ integrations: cache.rows, cachedMs: now - cache.at });
  }
  // Concurrent callers share one probe rather than each starting their own.
  if (!inFlight) {
    inFlight = statusAll().finally(() => { inFlight = null; });
  }

  try {
    const rows = await inFlight;
    cache = { at: Date.now(), rows };
    return NextResponse.json({ integrations: rows, cachedMs: 0 });
  } catch (e) {
    return NextResponse.json(
      { error: `Could not check the installed tools: ${String(e instanceof Error ? e.message : e)}` },
      { status: 500 },
    );
  }
}
