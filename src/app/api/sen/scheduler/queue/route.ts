import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { goApiFetch } from "@/lib/goApiProxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Proxy for the Go control plane's dry-run scheduler queue (phase 10 step 6).
// When the Go side is unavailable the route answers an honest empty payload
// instead of an error, so the UI can hide the section.
export async function GET(req: Request) {
  const guard = checkLocalRequest(req, { requireJson: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const result = await goApiFetch("/v1/sen/scheduler/queue");
  if (!result.ok || !result.body || typeof result.body !== "object") {
    return NextResponse.json(
      { available: false, dryRun: true, decisions: [], derivations: [] },
      { headers: { "cache-control": "no-store" } },
    );
  }
  return NextResponse.json(
    { ...(result.body as Record<string, unknown>), available: true },
    { headers: { "cache-control": "no-store" } },
  );
}
