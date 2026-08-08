import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { createWorkspace } from "@/lib/herdr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Open a fresh Herdr workspace to launch profiles into. */
export async function POST(req: Request) {
  const bad = checkLocalRequest(req);
  if (bad) return NextResponse.json({ error: bad.error }, { status: bad.status });

  const body = await req.json().catch(() => null) as { label?: string; cwd?: string } | null;
  const label = (body?.label ?? "Agent OS").replace(/[^\w .-]/g, "").slice(0, 40) || "Agent OS";

  const res = await createWorkspace(label, body?.cwd);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 502 });
  return NextResponse.json({ ok: true, workspace: res.data });
}
