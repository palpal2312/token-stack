import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { RunLedger } from "@/lib/llmops/ledger";
import { assertDifyEnabled } from "@/lib/dify/enablement";
import { DifyClient } from "@/lib/dify/client";
import { getProfile, getCurrentRevision } from "@/lib/dify/profile-registry";
import { getAgentOsUser } from "@/lib/dify/inputs";

/**
 * GET /api/integrations/dify/runs/[runId]/events
 * Resume a Dify workflow run and get an NDJSON stream.
 */
export async function GET(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const guardResult = await checkLocalRequest(req);
  if (guardResult) {
    return NextResponse.json({ error: guardResult.error }, { status: guardResult.status });
  }

  try {
    await assertDifyEnabled();
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }

  const { runId } = await ctx.params;

  try {
    const ledger = new RunLedger();
    const runEnvelope = await ledger.getRun(runId);
    
    if (!runEnvelope) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }
    
    if (runEnvelope.producerRef.kind !== "dify") {
      return NextResponse.json({ error: "Not a Dify run" }, { status: 400 });
    }

    const profileId = runEnvelope.producerRef.id;
    const profile = await getProfile(profileId);
    if (!profile || profile.tombstone) {
      return NextResponse.json({ error: "Profile not found or deleted" }, { status: 404 });
    }

    const revision = await getCurrentRevision(profileId);
    if (!revision || !revision.validated) {
      return NextResponse.json({ error: "Profile has no validated revision" }, { status: 400 });
    }

    const events = await ledger.readEvents({ runId });
    const reconciledEvent = events.find(e => e.type === "external_intent_reconciled");
    
    if (!reconciledEvent || !reconciledEvent.payload?.workflowRunId) {
       return NextResponse.json({ error: "Run not yet reconciled with upstream" }, { status: 409 });
    }

    const workflowRunId = reconciledEvent.payload.workflowRunId as string;
    const user = getAgentOsUser(profileId);

    const client = new DifyClient({
      serviceApiBase: revision.baseUrl,
      apiKey: revision.apiKey
    });

    const upstreamRes = await client.getEvents(workflowRunId, user, req.signal);

    return NextResponse.json(upstreamRes);

  } catch (error: any) {
    console.error(`[Dify Resume Run] Failed:`, error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
