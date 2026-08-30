import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { goApiFetch } from "@/lib/goApiProxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The session's active chat attempt (queued/claimed/running) or 404 — the
// pending-recovery read after reload.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = checkLocalRequest(req, { requireJson: false, allowQueryToken: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const { id } = await ctx.params;
  const result = await goApiFetch(`/v1/sen/chat/sessions/${encodeURIComponent(id)}/active`);
  if (!result.ok) {
    return NextResponse.json({ error: "no active chat attempt" }, { status: result.status === 404 ? 404 : 503 });
  }
  return NextResponse.json(result.body);
}
