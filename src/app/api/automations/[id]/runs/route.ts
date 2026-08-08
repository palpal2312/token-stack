import { NextResponse } from "next/server";
import { listRuns, readTranscript, inFlightAutomations, readLiveRun } from "@/lib/automations";
import { RegistryCorrupt } from "@/lib/builders/registry";
import { checkLocalRequest } from "@/lib/localOnly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Read-only: run history for one automation, newest first. `?transcript=<runId>`
// attaches the runtime transcript markdown to that one record (capped), which
// is what the runs drawer expands inline.
//
// While a run is in flight there IS no record yet, so the response also
// carries `live`: the run's state read straight from its state file (status
// "running" + the tail of its steps). The drawer renders that instead of a
// record and keeps polling until it settles into one.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = checkLocalRequest(req, { requireJson: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const { id } = await ctx.params;
  try {
    const { runs, corrupt } = await listRuns(id);
    const wantTranscript = new URL(req.url).searchParams.get("transcript");
    let transcript: string | null = null;
    if (wantTranscript) transcript = await readTranscript(wantTranscript);
    const inFlight = inFlightAutomations().find((x) => x.automationId === id) ?? null;
    const live = inFlight
      ? { ...(await readLiveRun(inFlight.runId)), sinceMs: inFlight.sinceMs }
      : null;
    return NextResponse.json({ runs, corrupt, transcript, live });
  } catch (e) {
    if (e instanceof RegistryCorrupt) return NextResponse.json({ error: e.message, corrupt: true }, { status: 409 });
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
