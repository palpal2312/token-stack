import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { goApiFetch } from "@/lib/goApiProxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/allocator/status
 *
 * Returns the current state of the LiveScoringAllocator: operating mode,
 * builder pool, decision counts, feedback count, and the most recent
 * allocation decisions.
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

  const result = await goApiFetch("/v1/allocator/status");

  if (!result.ok || !result.body || typeof result.body !== "object") {
    return NextResponse.json(
      {
        available: false,
        mode: "advisory",
        builderCount: 0,
        builders: [],
        totalDecisions: 0,
        assignedCount: 0,
        rejectedCount: 0,
        feedbackCount: 0,
        minScore: 0,
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
