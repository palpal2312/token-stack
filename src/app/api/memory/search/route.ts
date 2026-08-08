import { NextResponse } from "next/server";
import { searchNotes, searchOmi } from "@/lib/vault";
import { checkLocalRequest } from "@/lib/localOnly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const guard = checkLocalRequest(req, { requireJson: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const [notes, omi] = await Promise.all([
    searchNotes(q, 30),
    searchOmi(q, 30),
  ]);
  return NextResponse.json({ q, notes, omi });
}
