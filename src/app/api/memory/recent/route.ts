import { NextResponse } from "next/server";
import { recentNotes } from "@/lib/vault";
import { checkLocalRequest } from "@/lib/localOnly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const guard = checkLocalRequest(req, { requireJson: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const recent = await recentNotes(12);
  return NextResponse.json({ recent });
}
