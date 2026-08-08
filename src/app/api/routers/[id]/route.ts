import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { getRouter, updateRouter, deleteRouter, publicRouter, RegistryCorrupt } from "@/lib/routers/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function failed(e: unknown) {
  if (e instanceof RegistryCorrupt) return NextResponse.json({ error: e.message, corrupt: true }, { status: 409 });
  const msg = String(e instanceof Error ? e.message : e);
  // "No Router x" is the caller addressing something that is not there, not a fault.
  return NextResponse.json({ error: msg }, { status: /^No Router/.test(msg) ? 404 : 400 });
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const r = await getRouter(id);
    if (!r) return NextResponse.json({ error: `No Router "${id}".` }, { status: 404 });
    return NextResponse.json({ router: publicRouter(r) });
  } catch (e) { return failed(e); }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const { id } = await ctx.params;
  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Body must be JSON." }, { status: 400 }); }

  try {
    const router = await updateRouter(id, {
      name: body.name === undefined ? undefined : String(body.name),
      baseUrl: body.baseUrl === undefined ? undefined : String(body.baseUrl),
      apiKey: body.apiKey === undefined ? undefined : String(body.apiKey),
      defaultModel: body.defaultModel === undefined ? undefined : (body.defaultModel as string | null),
      isDefault: body.isDefault === undefined ? undefined : Boolean(body.isDefault),
      notes: body.notes === undefined ? undefined : String(body.notes),
      plan: body.plan === undefined ? undefined : Boolean(body.plan),
      payg: body.payg === undefined ? undefined : Boolean(body.payg),
      dashboardUrl: body.dashboardUrl === undefined ? undefined : (body.dashboardUrl as string | null),
      planQuota: body.planQuota === undefined ? undefined : (body.planQuota as string | null),
    });
    return NextResponse.json({ router: publicRouter(router) });
  } catch (e) { return failed(e); }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  // requireJson: false — a DELETE carries no body, so demanding a JSON content
  // type would only reject legitimate callers. The origin check still applies.
  const guard = checkLocalRequest(req, { requireJson: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const { id } = await ctx.params;
  try {
    await deleteRouter(id);
    return NextResponse.json({ ok: true });
  } catch (e) { return failed(e); }
}
