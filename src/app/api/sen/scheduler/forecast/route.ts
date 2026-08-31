import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { buildForecast, type EstimateProposal } from "@/features/forecast/forecast";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const guard = checkLocalRequest(req, { requireJson: true });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });
  try {
    const proposal = await req.json() as EstimateProposal;
    return NextResponse.json(buildForecast(proposal), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ schemaVersion:"1.0.0", errorCode:"FORECAST_INVALID", retryable:false, policyRevision:"s08a-policy-1", correlationId:crypto.randomUUID(), message:error instanceof Error ? error.message : "invalid forecast" }, { status:400 });
  }
}
