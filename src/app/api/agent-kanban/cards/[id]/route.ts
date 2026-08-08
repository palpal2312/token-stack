import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import {
  deleteCard,
  getCard,
  getEvents,
  KanbanStoreError,
  updateCard,
} from "@/lib/agent-kanban/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function failed(error: unknown): NextResponse {
  if (error instanceof KanbanStoreError) return NextResponse.json({ error: error.message }, { status: error.status });
  return NextResponse.json({ error: String(error instanceof Error ? error.message : error) }, { status: 500 });
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = checkLocalRequest(req, { requireJson: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const { id } = await ctx.params;
  const card = await getCard(id);
  if (!card) return NextResponse.json({ error: `No Kanban card "${id}".` }, { status: 404 });
  const url = new URL(req.url);
  const since = Math.max(0, Number(url.searchParams.get("since")) || 0);
  const limit = Math.max(1, Number(url.searchParams.get("limit")) || 100);
  const beforeRaw = Number(url.searchParams.get("before"));
  const before = Number.isSafeInteger(beforeRaw) && beforeRaw > 0 ? beforeRaw : undefined;
  return NextResponse.json({ card, events: await getEvents(since, { cardId: id, limit, before }) }, {
    headers: { "cache-control": "no-store" },
  });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const { id } = await ctx.params;
  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Body must be JSON." }, { status: 400 }); }
  try {
    const card = await updateCard(id, {
      ...(body.title !== undefined ? { title: String(body.title) } : {}),
      ...(body.brief !== undefined ? { brief: String(body.brief) } : {}),
      ...(body.note !== undefined ? { note: String(body.note) } : {}),
      ...(body.links && typeof body.links === "object" ? { links: body.links as Record<string, string> } : {}),
    });
    return NextResponse.json({ card });
  } catch (error) { return failed(error); }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = checkLocalRequest(req, { requireJson: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const { id } = await ctx.params;
  try {
    await deleteCard(id);
    return NextResponse.json({ ok: true });
  } catch (error) { return failed(error); }
}
