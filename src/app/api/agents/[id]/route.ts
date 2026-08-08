import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { resolveAgent, updateAgent, deleteAgent } from "@/lib/agents-registry";
import { RegistryCorrupt } from "@/lib/builders/registry";
import { readHistory, purgeAgentData } from "@/lib/builders/history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function oops(e: unknown, status = 400) {
  if (e instanceof RegistryCorrupt) return NextResponse.json({ error: e.message, corrupt: true }, { status: 409 });
  return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status });
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const r = await resolveAgent(id);
    if (!r) return NextResponse.json({ error: `No agent "${id}".` }, { status: 404 });
    // A problem is reported alongside the agent, not as an HTTP error: the page
    // still has to render, explain what broke, and offer the fix.
    return NextResponse.json({
      agent: r.agent,
      builderId: r.builderId,
      routerId: r.routerId,
      problem: r.problem,
      history: await readHistory(id),
    });
  } catch (e) { return oops(e, 500); }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const { id } = await ctx.params;

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Body must be JSON." }, { status: 400 }); }

  const patch: Record<string, unknown> = {};
  for (const k of ["name", "backend", "model", "notes"]) if (k in body) patch[k] = body[k];

  try {
    const agent = await updateAgent(id, patch);
    return NextResponse.json({ agent });
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    return oops(e, /^No agent/.test(msg) ? 404 : 400);
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = checkLocalRequest(req, { requireJson: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const { id } = await ctx.params;
  // The transcript survives a delete unless it is asked for explicitly, the same
  // way deleting a Builder leaves its credential directory alone.
  const purge = new URL(req.url).searchParams.get("purge") === "1";

  try {
    await deleteAgent(id);
    if (purge) await purgeAgentData(id);
    return NextResponse.json({ ok: true, purged: purge });
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    return oops(e, /^No agent/.test(msg) ? 404 : 400);
  }
}
