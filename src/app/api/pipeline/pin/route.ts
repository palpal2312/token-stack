import { NextResponse } from "next/server";
import { readItem, writeItem } from "@/lib/pipeline";
import { checkLocalRequest } from "@/lib/localOnly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Toggle/set whether an item is featured (pinned to the top of its column).
export async function POST(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const body = await req.json().catch(() => ({}));
  const slug = String(body.slug || "");
  const item = await readItem(slug);
  if (!item) return NextResponse.json({ ok: false, error: "Item not found." }, { status: 404 });
  item.pinned = body.pinned === undefined ? !item.pinned : body.pinned === true;
  await writeItem(item);
  return NextResponse.json({ ok: true, item });
}
