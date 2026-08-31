import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { goApiFetch } from "@/lib/goApiProxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Stream event tail for one chat attempt: after_seq cursor, seq-ordered —
// the reconnect/replay read.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = checkLocalRequest(req, { requireJson: false, allowQueryToken: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const afterSeq = url.searchParams.get("after_seq") ?? "0";
  const limit = url.searchParams.get("limit") ?? "200";
  const result = await goApiFetch(
    `/v1/sen/chat/attempts/${encodeURIComponent(id)}/events?after_seq=${encodeURIComponent(afterSeq)}&limit=${encodeURIComponent(limit)}`,
  );
  if (!result.ok) {
    return NextResponse.json({ error: "canonical chat events unavailable" }, { status: 503 });
  }
  return NextResponse.json(result.body);
}
