import { NextResponse } from "next/server";
import { appendMemory, listMemories } from "@/lib/apolloMemory";
import { checkLocalRequest } from "@/lib/localOnly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET → everything Apollo has been told to remember (newest first).
export async function GET() {
  try {
    return NextResponse.json({ memories: await listMemories(50) });
  } catch (e) {
    return NextResponse.json({ memories: [], error: String(e) }, { status: 200 });
  }
}

// POST { text } → save a new memory to disk + the Obsidian vault.
export async function POST(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  let body: { text?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }
  const text = (body.text ?? "").toString().trim();
  if (!text) return NextResponse.json({ ok: false }, { status: 400 });
  const row = await appendMemory(text);
  return NextResponse.json({ ok: true, ...row });
}
