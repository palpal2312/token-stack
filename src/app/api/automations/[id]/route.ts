import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import {
  updateAutomation, deleteAutomation, listRuns, runtimeRunsDir,
  type PatchAutomationInput,
} from "@/lib/automations";
import { FileStateStore } from "@/lib/agentRuntime/state";
import { closeRun } from "@/lib/closeRun";
import { RegistryCorrupt } from "@/lib/builders/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function failed(e: unknown) {
  if (e instanceof RegistryCorrupt) return NextResponse.json({ error: e.message, corrupt: true }, { status: 409 });
  return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
}

// Guarded: editing a schedule changes what runs unattended tonight.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const { id } = await ctx.params;

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Body must be JSON." }, { status: 400 }); }

  const patch: PatchAutomationInput = {};
  if (body.name !== undefined) patch.name = String(body.name);
  if (body.prompt !== undefined) patch.prompt = String(body.prompt);
  if (body.intervalMin !== undefined) patch.intervalMin = body.intervalMin === null ? null : Number(body.intervalMin);
  if (body.timeOfDay !== undefined) patch.timeOfDay = body.timeOfDay === null ? null : String(body.timeOfDay);
  if (body.requiresApproval !== undefined) patch.requiresApproval = Boolean(body.requiresApproval);
  if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled);

  try {
    const automation = await updateAutomation(id, patch);
    return NextResponse.json({ automation });
  } catch (e) {
    if (e instanceof RegistryCorrupt) return failed(e);
    const msg = String(e instanceof Error ? e.message : e);
    return NextResponse.json({ error: msg }, { status: msg.startsWith("No automation") ? 404 : 400 });
  }
}

// Guarded: removes the schedule (run history on disk is kept — it is a trace,
// not clutter, and deleting it with the row would hide what the machine did).
// Blocked runs of the deleted automation are closed, not orphaned: nobody can
// answer their parked asks anymore, so they get an honest "failed" ending.
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = checkLocalRequest(req, { requireJson: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const { id } = await ctx.params;
  try {
    const { runs } = await listRuns(id);
    await deleteAutomation(id);
    const store = new FileStateStore(runtimeRunsDir());
    let closedRuns = 0;
    for (const rec of runs) {
      if (rec.status !== "blocked") continue;
      const res = await closeRun(store, rec.id, "automation deleted", { by: `automation:${id}` });
      if (res.closed) closedRuns += 1;
    }
    return NextResponse.json({ ok: true, closedRuns });
  } catch (e) {
    if (e instanceof RegistryCorrupt) return failed(e);
    const msg = String(e instanceof Error ? e.message : e);
    return NextResponse.json({ error: msg }, { status: msg.startsWith("No automation") ? 404 : 400 });
  }
}
