import { NextResponse } from "next/server";
import { readPane } from "@/lib/herdr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The visible text of one pane. Read-only: it does not touch what is running. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const paneId = url.searchParams.get("id")?.trim();
  if (!paneId) return NextResponse.json({ error: "Which pane?" }, { status: 400 });

  const lines = Math.min(400, Math.max(5, Number(url.searchParams.get("lines")) || 60));
  const res = await readPane(paneId, lines);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 502 });
  return NextResponse.json({ paneId, output: res.data ?? "" });
}
