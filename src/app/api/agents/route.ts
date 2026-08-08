import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { listAgents, createAgent, resolveAgent } from "@/lib/agents-registry";
import { RegistryCorrupt } from "@/lib/builders/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function oops(e: unknown, status = 400) {
  if (e instanceof RegistryCorrupt) return NextResponse.json({ error: e.message, corrupt: true }, { status: 409 });
  return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status });
}

export async function GET() {
  try {
    const agents = await listAgents();
    // The sidebar renders this list, so a dangling Builder must not make an
    // agent vanish from it — the entry stays and carries its problem.
    const rows = await Promise.all(agents.map(async (a) => {
      const r = await resolveAgent(a.id);
      return { ...a, ready: Boolean(r && !r.problem), problem: r?.problem ?? null };
    }));
    return NextResponse.json({ agents: rows });
  } catch (e) { return oops(e, 500); }
}

export async function POST(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Body must be JSON." }, { status: 400 }); }

  const backend = body.backend as { kind?: string; refId?: string } | undefined;
  if (!backend?.kind) return NextResponse.json({ error: "Choose a backend for this agent." }, { status: 400 });

  try {
    const agent = await createAgent({
      name: String(body.name ?? ""),
      skinId: String(body.skinId ?? ""),
      backend: { kind: backend.kind as "builder" | "builtin" | "router", refId: backend.refId },
      model: (body.model as string | null | undefined) ?? null,
      notes: String(body.notes ?? ""),
    });
    return NextResponse.json({ agent }, { status: 201 });
  } catch (e) { return oops(e); }
}
