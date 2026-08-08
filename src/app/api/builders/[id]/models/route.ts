import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { getBuilder } from "@/lib/builders/registry";
import { modelsForBuilder } from "@/lib/sen-models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = checkLocalRequest(req, { requireJson: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const { id } = await ctx.params;
  const builder = await getBuilder(id);
  if (!builder) return NextResponse.json({ error: `No profile "${id}".` }, { status: 404 });

  try {
    return NextResponse.json({ modelsInfo: await modelsForBuilder(builder) });
  } catch (error) {
    return NextResponse.json({ modelsInfo: null, error: String(error instanceof Error ? error.message : error) });
  }
}
