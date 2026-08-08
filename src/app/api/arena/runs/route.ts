import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { listRuns, updateRun } from "@/lib/builders/arena";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const limit = Math.min(200, Math.max(1, Number(new URL(req.url).searchParams.get("limit")) || 50));
  try {
    return NextResponse.json({ runs: await listRuns(limit) });
  } catch (e) {
    return NextResponse.json({ runs: [], error: `Could not read the race history: ${String((e as Error)?.message ?? e)}` }, { status: 500 });
  }
}

/** Mark a winner or leave a note on a past race. */
export async function PATCH(req: Request) {
  const bad = checkLocalRequest(req);
  if (bad) return NextResponse.json({ error: bad.error }, { status: bad.status });

  const body = await req.json().catch(() => null) as { runId?: string; winner?: string | null; note?: string } | null;
  const runId = body?.runId?.trim();
  if (!runId) return NextResponse.json({ error: "Which race?" }, { status: 400 });

  const patch: { winner?: string | null; note?: string } = {};
  if ("winner" in (body ?? {})) patch.winner = body!.winner ?? null;
  if (typeof body?.note === "string") patch.note = body.note.slice(0, 2_000);
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });

  const updated = await updateRun(runId, patch);
  if (!updated) return NextResponse.json({ error: `No race "${runId}" in the history.` }, { status: 404 });
  return NextResponse.json({ run: updated });
}
