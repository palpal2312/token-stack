import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { sendToAgent, readPane } from "@/lib/herdr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Type a prompt into a running pane and press Enter. */
export async function POST(req: Request) {
  const bad = checkLocalRequest(req);
  if (bad) return NextResponse.json({ error: bad.error }, { status: bad.status });

  const body = await req.json().catch(() => null) as { paneId?: string; text?: string } | null;
  const paneId = body?.paneId?.trim();
  const text = body?.text ?? "";
  if (!paneId) return NextResponse.json({ error: "Which pane should receive this?" }, { status: 400 });
  if (!text.trim()) return NextResponse.json({ error: "Nothing to send." }, { status: 400 });

  const sent = await sendToAgent(paneId, text);
  if (!sent.ok) return NextResponse.json({ error: sent.error }, { status: 502 });

  // Read back immediately so the UI can show the prompt landed, not just that
  // the call returned. The agent will still be thinking; that is what it looks like.
  const echo = await readPane(paneId, 30);
  return NextResponse.json({ ok: true, output: echo.data ?? "" });
}
