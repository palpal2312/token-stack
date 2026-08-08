import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { readKanbanConfig, writeKanbanConfig } from "@/lib/agent-kanban/config";
import { getBuilder } from "@/lib/builders/registry";
import type { KanbanRoleConfig } from "@/lib/agent-kanban/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const guard = checkLocalRequest(req, { requireJson: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });
  return NextResponse.json({ config: await readKanbanConfig() }, { headers: { "cache-control": "no-store" } });
}

export async function PUT(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });
  let body: Partial<KanbanRoleConfig>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Body must be JSON." }, { status: 400 }); }
  for (const role of ["planner", "builder", "reviewer"] as const) {
    const choice = body[role];
    if (choice?.engine === "builder") {
      if (!choice.builderId) return NextResponse.json({ error: `${role}.builderId is required.` }, { status: 400 });
      const builder = await getBuilder(choice.builderId);
      if (!builder?.verifiedAt) {
        return NextResponse.json({ error: `Builder "${choice.builderId}" must be verified first.` }, { status: 409 });
      }
    }
  }
  return NextResponse.json({ config: await writeKanbanConfig(body) });
}

