import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { goApiFetch } from "@/lib/goApiProxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Proxy for the Go planning surface (phase 12 step 7). When the Go control
// plane is unavailable the route answers an honest empty payload so the UI
// hides the planning card instead of erroring.
export async function GET(req: Request, ctx: { params: Promise<{ goalID: string }> }) {
  const guard = checkLocalRequest(req, { requireJson: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const { goalID } = await ctx.params;
  const result = await goApiFetch(`/v1/sen/planning/goals/${encodeURIComponent(goalID)}/plan`);
  if (!result.ok || !result.body || typeof result.body !== "object") {
    if (result.status === 404) {
      return NextResponse.json({ available: true, plan: null }, { headers: { "cache-control": "no-store" } });
    }
    return NextResponse.json({ available: false, plan: null }, { headers: { "cache-control": "no-store" } });
  }
  return NextResponse.json(
    { available: true, plan: result.body },
    { headers: { "cache-control": "no-store" } },
  );
}
