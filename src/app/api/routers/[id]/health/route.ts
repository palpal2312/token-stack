import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { getRouter } from "@/lib/routers/registry";
import { probeRouter, probeRouterQuota } from "@/lib/routers/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST, not GET, and guarded — deliberately a step stricter than the plan's
 * sketch. This probe sends the profile's API key to whatever base URL the profile
 * holds. A cross-origin GET needs no preflight, so a page you have open could
 * otherwise make the dashboard replay your key at a moment of its choosing. The
 * guard in lib/localOnly.ts names this exact attack.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = checkLocalRequest(req, { requireJson: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const { id } = await ctx.params;
  try {
    const r = await getRouter(id);
    if (!r) return NextResponse.json({ error: `No Router "${id}".` }, { status: 404 });
    const health = await probeRouter(r);
    // Also probe quota when the router has plan or payg billing configured
    if (r.plan || r.payg) {
      health.quota = await probeRouterQuota(r);
    }
    return NextResponse.json({ health });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
