import fs from "node:fs";
import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { hermesHome } from "@/lib/config";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILE = path.join(hermesHome(), "profiles", "sakana-fugu", "chat-history.json");

interface Msg { role: "user" | "assistant"; text: string; }

export async function GET() {
  try {
    const raw = fs.readFileSync(FILE, "utf8");
    const msgs = JSON.parse(raw);
    return Response.json({ msgs: Array.isArray(msgs) ? msgs : [] });
  } catch {
    return Response.json({ msgs: [] });
  }
}

export async function POST(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  try {
    const { msgs } = (await req.json()) as { msgs: Msg[] };
    if (!Array.isArray(msgs)) return Response.json({ ok: false, error: "msgs must be an array" }, { status: 400 });
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(msgs.slice(-200)), "utf8");
    return Response.json({ ok: true, saved: msgs.length });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
