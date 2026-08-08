import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { fireAutomation, getAutomation, CapReached, AlreadyRunning, MAX_RUNS_PER_DAY } from "@/lib/automations";
import { RegistryCorrupt } from "@/lib/builders/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Guarded: this fires a model or a CLI right now, on demand.
//
// A manual run counts toward the SAME 6/day cap as scheduled ones — the cap
// bounds spend, and spend from a clicked button is still spend. The response
// says so plainly so the UI never has to guess.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = checkLocalRequest(req, { requireJson: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const { id } = await ctx.params;

  try {
    if (!(await getAutomation(id))) {
      return NextResponse.json({ error: `No automation "${id}".` }, { status: 404 });
    }
    const run = await fireAutomation(id, "manual");
    const after = await getAutomation(id);
    return NextResponse.json({
      run,
      countsTowardCap: true,
      runsToday: after?.runsToday ?? null,
      cap: MAX_RUNS_PER_DAY,
    }, { status: 201 });
  } catch (e) {
    if (e instanceof RegistryCorrupt) {
      return NextResponse.json({ error: e.message, corrupt: true }, { status: 409 });
    }
    if (e instanceof CapReached) {
      return NextResponse.json({ error: e.message, capReached: true, runsToday: e.automation.runsToday, cap: MAX_RUNS_PER_DAY }, { status: 429 });
    }
    if (e instanceof AlreadyRunning) {
      return NextResponse.json({ error: e.message, overlap: true }, { status: 409 });
    }
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
