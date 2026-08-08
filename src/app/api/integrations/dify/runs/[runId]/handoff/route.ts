import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { readBoundedJson } from "@/lib/dify/request";
import { createHandoff } from "@/lib/dify/handoff";

/**
 * POST /api/integrations/dify/runs/[runId]/handoff
 * Create a handoff token to pass to Builder/FirstMate.
 */
export async function POST(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const guardResult = await checkLocalRequest(req);
  if (guardResult) {
    return NextResponse.json({ error: guardResult.error }, { status: guardResult.status });
  }

  const { runId } = await ctx.params;

  const bodyResult = await readBoundedJson<{ artifactIds: string[], goal?: string }>(req);
  if (!bodyResult.ok) {
    return NextResponse.json({ error: bodyResult.error }, { status: bodyResult.statusCode });
  }

  const { artifactIds, goal } = bodyResult.data;

  if (!Array.isArray(artifactIds)) {
    return NextResponse.json({ error: "artifactIds must be an array" }, { status: 400 });
  }

  try {
    const handoffId = await createHandoff(runId, artifactIds, goal);
    return NextResponse.json({ handoffId });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to create handoff" },
      { status: 500 }
    );
  }
}
