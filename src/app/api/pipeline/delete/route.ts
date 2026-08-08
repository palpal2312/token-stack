import { NextResponse } from "next/server";
import { deleteItem } from "@/lib/pipeline";
import { checkLocalRequest } from "@/lib/localOnly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Permanently delete a pipeline item (removes its Markdown file from the vault).
export async function POST(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const { slug } = await req.json().catch(() => ({}));
  if (!slug || typeof slug !== "string") return NextResponse.json({ ok: false, error: "missing slug" }, { status: 400 });
  const ok = await deleteItem(slug);
  return NextResponse.json({ ok });
}
