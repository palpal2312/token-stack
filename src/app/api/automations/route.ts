import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import {
  listAutomations, createAutomation, ensureScheduler,
  inFlightAutomations, lastStepText,
  MAX_RUNS_PER_DAY, MIN_INTERVAL_MIN, MAX_INTERVAL_MIN,
} from "@/lib/automations";
import { RegistryCorrupt } from "@/lib/builders/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function failed(e: unknown) {
  if (e instanceof RegistryCorrupt) return NextResponse.json({ error: e.message, corrupt: true }, { status: 409 });
  return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
}

export async function GET() {
  // The first request of the day is what starts the 60s tick — the scheduler
  // is dashboard-resident v1: while this server is down, nothing fires, and
  // the catch-up-once rule means a missed window fires once when it comes back.
  ensureScheduler();
  try {
    const automations = await listAutomations();
    // The in-flight marker rides the response, not the stored row — it is
    // in-process scheduler state joined with the state file's last step.
    const inFlight = new Map(inFlightAutomations().map((x) => [x.automationId, x]));
    const withLive = await Promise.all(automations.map(async (a) => {
      const f = inFlight.get(a.id);
      if (!f) return { ...a, inFlight: null };
      return { ...a, inFlight: { runId: f.runId, sinceMs: f.sinceMs, lastStep: await lastStepText(f.runId) } };
    }));
    return NextResponse.json({
      automations: withLive,
      cap: MAX_RUNS_PER_DAY,
      interval: { min: MIN_INTERVAL_MIN, max: MAX_INTERVAL_MIN },
      scheduler: { tickSeconds: 60, resident: true },
    });
  } catch (e) { return failed(e); }
}

// Guarded: this writes a schedule that will later run a model or a CLI unattended.
export async function POST(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Body must be JSON." }, { status: 400 }); }

  const brainRef = body.brainRef as Record<string, unknown> | undefined;
  const ref = brainRef?.kind === "router"
    ? { kind: "router" as const, routerId: String(brainRef.routerId ?? "") }
    : brainRef?.kind === "firstmate"
      ? { kind: "firstmate" as const, routerId: String(brainRef.routerId ?? "") }
      : brainRef?.kind === "builder"
        ? { kind: "builder" as const, builderId: String(brainRef.builderId ?? "") }
        : null;
  if (!ref) return NextResponse.json({ error: "brainRef must be {kind:'router',routerId}, {kind:'firstmate',routerId} or {kind:'builder',builderId}." }, { status: 400 });

  try {
    const automation = await createAutomation({
      name: String(body.name ?? ""),
      prompt: String(body.prompt ?? ""),
      intervalMin: body.intervalMin === undefined || body.intervalMin === null ? undefined : Number(body.intervalMin),
      timeOfDay: body.timeOfDay === undefined || body.timeOfDay === null || body.timeOfDay === "" ? undefined : String(body.timeOfDay),
      brainRef: ref,
      requiresApproval: body.requiresApproval === undefined ? true : Boolean(body.requiresApproval),
      enabled: body.enabled === undefined ? true : Boolean(body.enabled),
    });
    return NextResponse.json({ automation, cap: MAX_RUNS_PER_DAY }, { status: 201 });
  } catch (e) {
    if (e instanceof RegistryCorrupt) return failed(e);
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 400 });
  }
}
