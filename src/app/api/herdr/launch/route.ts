import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { launchAgent } from "@/lib/herdr";
import { builderSpawn, BuilderSpawnError } from "@/lib/builders/spawn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Start a Builder profile as an agent in a Herdr pane.
 *
 * This is the point of the Code Space: the profile's isolation directory goes
 * into the pane through Herdr's `--env`, so a second Claude account runs in its
 * own terminal under its own login, next to the first.
 */
export async function POST(req: Request) {
  const bad = checkLocalRequest(req);
  if (bad) return NextResponse.json({ error: bad.error }, { status: bad.status });

  const body = await req.json().catch(() => null) as {
    builderId?: string; cwd?: string; workspaceId?: string; split?: "right" | "down"; label?: string;
  } | null;
  if (!body?.builderId) {
    return NextResponse.json({ error: "Pick a Builder profile to launch." }, { status: 400 });
  }

  let resolved;
  try { resolved = await builderSpawn(body.builderId); }
  catch (e) {
    if (e instanceof BuilderSpawnError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }

  const label = (body.label ?? resolved.builder.name).replace(/[^\w .-]/g, "").slice(0, 60) || resolved.builder.id;
  const res = await launchAgent({
    bin: resolved.binOverride!,
    args: resolved.argsPrefix ?? [],
    label,
    cwd: body.cwd,
    env: resolved.extraEnv,
    workspaceId: body.workspaceId,
    split: body.split,
  });

  if (!res.ok) return NextResponse.json({ error: res.error, warnings: resolved.warnings }, { status: 502 });
  return NextResponse.json({ ok: true, launched: label, result: res.data, warnings: resolved.warnings });
}
