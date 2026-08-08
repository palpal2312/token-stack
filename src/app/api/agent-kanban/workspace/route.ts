import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { listBuilds, deleteBuild } from "@/lib/kanbanStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  /api/agent-kanban/workspace        — every build the team has ever made (newest first)
// DELETE /api/agent-kanban/workspace?id=  — remove one build
export async function GET() {
  const builds = await listBuilds();
  return NextResponse.json({ builds }, { headers: { "cache-control": "no-store" } });
}

export async function DELETE(req: Request) {
  const guard = checkLocalRequest(req, { requireJson: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  await deleteBuild(id);
  return NextResponse.json({ ok: true });
}
