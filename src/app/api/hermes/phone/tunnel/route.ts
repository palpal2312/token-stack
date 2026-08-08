import { NextResponse } from "next/server";
import { startTunnel, stopTunnel, tunnelStatus } from "@/lib/hermesPhone";
import { checkLocalRequest } from "@/lib/localOnly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  let action = "start";
  try { action = (await req.json())?.action ?? "start"; } catch { /* default */ }

  if (action === "stop") {
    stopTunnel();
    return NextResponse.json({ ok: true, ...(await tunnelStatus()) });
  }
  const r = await startTunnel();
  if (!r.url) return NextResponse.json({ ok: false, error: r.error ?? "failed to start" }, { status: 200 });
  return NextResponse.json({ ok: true, ...(await tunnelStatus()) });
}
