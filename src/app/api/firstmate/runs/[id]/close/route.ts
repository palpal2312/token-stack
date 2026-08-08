import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { FileStateStore } from "@/lib/agentRuntime/state";
import { runtimeRunsDir } from "@/lib/automations";
import { closeRun } from "@/lib/closeRun";
import { RegistryCorrupt } from "@/lib/builders/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Guarded: closing a run ends something a human may still mean to answer.
// The manual way out for an interactive zombie — a blocked run whose parked
// ask nobody will decide. The reason goes on the transcript; omitting it
// records the default "closed by user".
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const { id } = await ctx.params;

  let body: Record<string, unknown> = {};
  try { body = (await req.json()) as Record<string, unknown>; }
  catch { /* an empty JSON body just takes the default reason */ }

  const reason = String(body.reason ?? "").trim() || "closed by user";

  try {
    const store = new FileStateStore(runtimeRunsDir());
    const res = await closeRun(store, id, reason, { by: "user" });
    return NextResponse.json({ ok: true, reason: res.reason, closed: res.closed, rejectedApprovals: res.rejectedApprovals });
  } catch (e) {
    if (e instanceof RegistryCorrupt) {
      return NextResponse.json({ error: e.message, corrupt: true }, { status: 409 });
    }
    const msg = String(e instanceof Error ? e.message : e);
    return NextResponse.json({ error: msg }, { status: msg.startsWith("No run") ? 404 : 400 });
  }
}
