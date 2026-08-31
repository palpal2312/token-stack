import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { goApiFetch } from "@/lib/goApiProxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cursor-based canonical thread read: /v1/sen/chat/sessions/{id}/thread with
// after_seq/limit. Projection-first — pure proxy, no computation.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = checkLocalRequest(req, { requireJson: false, allowQueryToken: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const afterSeq = url.searchParams.get("after_seq") ?? "0";
  const limit = url.searchParams.get("limit") ?? "200";
  const result = await goApiFetch(
    `/v1/sen/chat/sessions/${encodeURIComponent(id)}/thread?after_seq=${encodeURIComponent(afterSeq)}&limit=${encodeURIComponent(limit)}`,
  );
  if (!result.ok) {
    return NextResponse.json({ error: "canonical chat thread unavailable" }, { status: result.status === 404 ? 404 : 503 });
  }
  return NextResponse.json(result.body);
}
