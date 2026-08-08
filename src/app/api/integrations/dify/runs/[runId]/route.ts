import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { RunLedger } from "@/lib/llmops/ledger";
import { assertDifyEnabled } from "@/lib/dify/enablement";

/**
 * GET /api/integrations/dify/runs/[runId]
 * Get sanitized run details and reconciliation status.
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

    // Check events to see if it's been reconciled
    const events = await ledger.readEvents({ runId });
    const reconciledEvent = events.find(e => e.type === "external_intent_reconciled");

    return NextResponse.json({
      runId,
      status: runEnvelope.status,
      reconciled: !!reconciledEvent,
      workflowRunId: reconciledEvent?.payload?.workflowRunId,
      taskId: reconciledEvent?.payload?.taskId,
      createdAt: runEnvelope.createdAt,
      startedAt: runEnvelope.startedAt,
      endedAt: runEnvelope.endedAt
    });
  } catch (error: any) {
    console.error(`[Dify GET Run] Failed:`, error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
