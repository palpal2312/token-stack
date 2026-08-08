import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { goApiFetch } from "@/lib/goApiProxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/scheduler/status
 *
 * Returns the current state of the CommittingDispatcher: operating mode,
 * WIP limits, decision counts, and the most recent dispatch decisions.
 *
 * When the Go control plane is available the request is proxied there.
 * When it is not, a stub payload is returned so the dashboard can hide
 * the section gracefully.
 */
export async function GET(req: Request) {
  const guard = checkLocalRequest(req, { requireJson: false });
  if (guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const result = await goApiFetch("/v1/scheduler/status");

  if (!result.ok || !result.body || typeof result.body !== "object") {
    return NextResponse.json(
      {
        available: false,
        mode: "dry-run",
        limits: { Global: 0, PerGoal: 0, PerAccount: 0 },
        totalDecisions: 0,
        dispatchedCount: 0,
        rejectedCount: 0,
        recentDecisions: [],
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  return NextResponse.json(
    { ...(result.body as Record<string, unknown>), available: true },
    { headers: { "cache-control": "no-store" } },
  );
}
