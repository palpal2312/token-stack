import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { readBoundedJson } from "@/lib/dify/request";
import { materializeOutput } from "@/lib/dify/materialize";

/**
 * POST /api/integrations/dify/runs/[runId]/materialize
 * Materialize a Dify output into an Agent OS artifact.
 */
export async function POST(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const guardResult = await checkLocalRequest(req);
  if (guardResult) {
    return NextResponse.json({ error: guardResult.error }, { status: guardResult.status });
  }

  const { runId } = await ctx.params;

  const bodyResult = await readBoundedJson<{ outputKey: string }>(req);
  if (!bodyResult.ok) {
    return NextResponse.json({ error: bodyResult.error }, { status: bodyResult.statusCode });
  }

  const { outputKey } = bodyResult.data;

  if (!outputKey || typeof outputKey !== "string") {
    return NextResponse.json({ error: "Missing or invalid outputKey" }, { status: 400 });
  }

  try {
    const artifact = await materializeOutput(runId, outputKey);
    return NextResponse.json({ artifact });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to materialize output" },
      { status: 500 }
    );
  }
}
