import { NextResponse } from "next/server";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { TRANSCRIPTS_DIR } from "@/lib/seoPipeline";
import { checkLocalRequest } from "@/lib/localOnly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  let body: { slug?: unknown; content?: unknown };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Body must be JSON." }, { status: 400 }); }
  const { slug, content } = body;
  if (typeof slug !== "string" || !/^[a-z0-9-]{3,80}$/.test(slug)) {
    return NextResponse.json({ error: "invalid slug" }, { status: 400 });
  }
  if (typeof content !== "string" || content.trim().length === 0) {
    return NextResponse.json({ error: "empty content" }, { status: 400 });
  }
  if (content.length > 500_000) {
    return NextResponse.json({ error: "too long" }, { status: 413 });
  }

  await mkdir(TRANSCRIPTS_DIR, { recursive: true });
  const file = path.join(TRANSCRIPTS_DIR, `${slug}.txt`);
  await writeFile(file, content, "utf8");
  return NextResponse.json({ ok: true, path: file, slug });
}
