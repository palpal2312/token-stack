import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { closePane } from "@/lib/herdr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const bad = checkLocalRequest(req);
  if (bad) return NextResponse.json({ error: bad.error }, { status: bad.status });

  const body = await req.json().catch(() => null) as { paneId?: string } | null;
  const paneId = body?.paneId?.trim();
  if (!paneId) return NextResponse.json({ error: "Which pane should be closed?" }, { status: 400 });

  const res = await closePane(paneId);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 502 });
  return NextResponse.json({ ok: true, closed: paneId });
}
