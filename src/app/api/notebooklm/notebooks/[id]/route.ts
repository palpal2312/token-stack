import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { callTool } from "@/lib/notebooklmClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const result = await callTool("notebook_get", { notebook_id: id });
    return NextResponse.json(result);
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const { id } = await params;
  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Body must be JSON." }, { status: 400 }); }
  try {
    if (typeof body.new_title === "string" || typeof body.title === "string") {
      const result = await callTool("notebook_rename", { notebook_id: id, new_title: body.new_title ?? body.title });
      return NextResponse.json(result);
    }
    return NextResponse.json({ error: "no patchable field" }, { status: 400 });
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  // No body is read here (the id comes from the URL), so JSON content-type can't
  // be required — the dashboard's own fetch sends none.
  const guard = checkLocalRequest(req, { requireJson: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const { id } = await params;
  try {
    const result = await callTool("notebook_delete", { notebook_id: id, confirm: true });
    return NextResponse.json(result);
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }
}
