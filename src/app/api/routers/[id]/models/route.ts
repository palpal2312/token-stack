import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { getRouter } from "@/lib/routers/registry";
import { listRouterModels } from "@/lib/routers/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The model ids this Router's endpoint lists — what a picker's dropdown is
 * allowed to offer. POST for the same reason the health probe is: the call
 * sends the profile's API key to whatever base URL the profile holds, so it
 * must not be a cross-origin GET away from replaying (lib/localOnly.ts names
 * the attack). An endpoint that does not list models answers with an empty
 * list and the reason, never with invented entries.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = checkLocalRequest(req, { requireJson: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const { id } = await ctx.params;
  try {
    const r = await getRouter(id);
    if (!r) return NextResponse.json({ error: `No Router "${id}".` }, { status: 404 });
    const { models, error } = await listRouterModels(r);
    return NextResponse.json({ models, defaultModel: r.defaultModel, error });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
