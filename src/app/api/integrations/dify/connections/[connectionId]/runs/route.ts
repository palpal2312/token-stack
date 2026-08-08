import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { readBoundedJson } from "@/lib/dify/request";
import { DifyRunBridge } from "@/lib/dify/run-bridge";
import { DIFY_MAX_RUN_BODY_BYTES } from "@/lib/dify/limits";

/**
 * POST /api/integrations/dify/connections/[connectionId]/runs
 * Submit a Dify workflow run and get an NDJSON stream back.
 */
export async function POST(req: Request, ctx: { params: Promise<{ connectionId: string }> }) {
  const guardResult = await checkLocalRequest(req, { requireJson: false });
  if (guardResult) {
    return NextResponse.json({ error: guardResult.error }, { status: guardResult.status });
  }

  const { connectionId } = await ctx.params;
  const submissionId = req.headers.get("x-agent-os-submission-id");

  if (!submissionId) {
    return NextResponse.json({ error: "Missing x-agent-os-submission-id header" }, { status: 400 });
  }

  const bodyResult = await readBoundedJson<Record<string, unknown>>(req, DIFY_MAX_RUN_BODY_BYTES);
  if (!bodyResult.ok) {
    return NextResponse.json({ error: bodyResult.error }, { status: bodyResult.statusCode });
  }

  const inputs = bodyResult.data.inputs as Record<string, unknown> || {};
  const stagedFiles = bodyResult.data.stagedFiles as string[] || [];

  try {
    const stream = await DifyRunBridge.startRun({
      profileId: connectionId,
      submissionId,
      inputs,
      stagedFiles,
      signal: req.signal,
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to start run" },
      { status: error.code || 500 }
    );
  }
}
