import { NextResponse } from "next/server";
import { appendApolloTurn, listApolloTurns, listApolloTurnsForDay } from "@/lib/apolloLog";
import { checkLocalRequest } from "@/lib/localOnly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET → recent history (newest first), or ?day=YYYY-MM-DD for one day's turns.
export async function GET(req: Request) {
  try {
    const day = new URL(req.url).searchParams.get("day");
    if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
      return NextResponse.json({ turns: await listApolloTurnsForDay(day), day });
    }
    return NextResponse.json({ turns: await listApolloTurns(100) });
  } catch (e) {
    return NextResponse.json({ turns: [], error: String(e) }, { status: 200 });
  }
}

// POST { you, apollo, kind } → log one turn to disk + the Obsidian vault.
export async function POST(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  let body: { you?: string; apollo?: string; kind?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }
  const you = (body.you ?? "").toString().trim();
  const apollo = (body.apollo ?? "").toString().trim();
  if (!you && !apollo) return NextResponse.json({ ok: false }, { status: 400 });
  const row = await appendApolloTurn(you, apollo, (body.kind ?? "chat").toString());
  return NextResponse.json({ ok: true, ...row });
}
