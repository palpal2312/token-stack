import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import {
  getBuilder, updateBuilder, deleteBuilder, publicBuilder, RegistryCorrupt,
} from "@/lib/builders/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function oops(e: unknown, status = 400) {
  if (e instanceof RegistryCorrupt) return NextResponse.json({ error: e.message, corrupt: true }, { status: 409 });
  return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status });
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const b = await getBuilder(id);
    if (!b) return NextResponse.json({ error: `No profile "${id}".` }, { status: 404 });
    return NextResponse.json({ builder: publicBuilder(b) });
  } catch (e) { return oops(e, 500); }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const { id } = await ctx.params;

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Body must be JSON." }, { status: 400 }); }

  // Only forward keys that are actually present: the registry treats an absent
  // field as "leave it alone", which is what keeps an untouched API key intact.
  const patch: Record<string, unknown> = {};
  for (const k of ["name", "secrets", "env", "bin", "args", "model", "effort", "isDefault", "notes", "quota"]) {
    if (k in body) patch[k] = body[k];
  }

  try {
    const b = await updateBuilder(id, patch);
    return NextResponse.json({ builder: publicBuilder(b) });
  } catch (e) { return oops(e); }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = checkLocalRequest(req, { requireJson: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const { id } = await ctx.params;
  // Deleting the profile is reversible; deleting its logged-in session is not, so
  // the credential directory only goes when explicitly asked for.
  const purge = new URL(req.url).searchParams.get("purge") === "1";
  try {
    const { removedDir } = await deleteBuilder(id, { purge });
    return NextResponse.json({ ok: true, removedDir });
  } catch (e) { return oops(e, 404); }
}
