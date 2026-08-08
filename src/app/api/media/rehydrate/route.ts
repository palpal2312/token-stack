import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { existsSync } from "node:fs";
import { extractPathsFromText, isAllowedMediaPath, type MediaKind } from "@/lib/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Given a Hermes reply (text), re-extract any media paths and report which ones still exist.
// Used to repair old history cards stored before the allowlist was widened.
export async function POST(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Body must be JSON." }, { status: 400 }); }
  const { kind, text } = body;
  if (typeof kind !== "string" || !["image", "video", "speech"].includes(kind)) {
    return NextResponse.json({ error: "kind must be image|video|speech" }, { status: 400 });
  }
  if (typeof text !== "string") return NextResponse.json({ error: "text required" }, { status: 400 });

  const candidates = extractPathsFromText(text, kind as MediaKind);
  const paths = candidates.filter((p) => isAllowedMediaPath(p) && existsSync(p));
  return NextResponse.json({ paths });
}
