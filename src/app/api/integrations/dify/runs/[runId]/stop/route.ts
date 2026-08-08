import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { RunLedger } from "@/lib/llmops/ledger";
import { assertDifyEnabled } from "@/lib/dify/enablement";
import { DifyClient } from "@/lib/dify/client";
import { getProfile, getCurrentRevision } from "@/lib/dify/profile-registry";
import { getAgentOsUser } from "@/lib/dify/inputs";
import { randomUUID } from "node:crypto";

/**
 * POST /api/integrations/dify/runs/[runId]/stop
 * Stop a Dify task.
 */
export async function POST(req: Request, ctx: { params: Promise<{ runId: string }> }) {
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

    if (runEnvelope.status !== "running" && runEnvelope.status !== "queued") {
      return NextResponse.json({ error: `Cannot stop run in status: ${runEnvelope.status}` }, { status: 400 });
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
    
    if (!reconciledEvent || !reconciledEvent.payload?.taskId) {
       return NextResponse.json({ error: "Run not yet reconciled with upstream task" }, { status: 409 });
    }

    const taskId = reconciledEvent.payload.taskId as string;
    const user = getAgentOsUser(profileId);

    const client = new DifyClient({
      serviceApiBase: revision.baseUrl,
      apiKey: revision.apiKey
    });

    try {
      await client.stopTask(taskId, user, req.signal);
      
      // Update ledger to cancelled
      runEnvelope.status = "cancelled";
      runEnvelope.endedAt = new Date().toISOString();
      
      await ledger.append({
        id: randomUUID(),
        type: "run_cancelled",
        run: runEnvelope,
        at: runEnvelope.endedAt,
        redactionClass: "local-sensitive",
        payload: {
          reason: "User requested stop via API"
        }
      });
      
      return NextResponse.json({ success: true, status: "cancelled" });
    } catch (clientErr: any) {
      console.error(`[Dify Stop Task] Upstream error:`, clientErr);
      return NextResponse.json({ error: `Upstream error: ${clientErr.message}` }, { status: 502 });
    }

  } catch (error: any) {
    console.error(`[Dify Stop Run] Failed:`, error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
