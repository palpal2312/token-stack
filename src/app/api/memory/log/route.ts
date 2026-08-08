import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { appendMemory } from "@/lib/vaultWriter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Body must be JSON." }, { status: 400 }); }
  const agent = String(body.agent ?? "system");
  const kind = String(body.kind ?? "note");
  const user = body.user ? String(body.user).slice(0, 8000) : undefined;
  const reply = body.reply ? String(body.reply).slice(0, 16000) : undefined;
  const text = body.text ? String(body.text).slice(0, 8000) : undefined;

  const allowedAgents = new Set(["claude", "openclaw", "hermes", "user", "system"]);
  const allowedKinds = new Set(["chat", "goal", "journal", "note"]);
  if (!allowedAgents.has(agent) || !allowedKinds.has(kind)) {
    return NextResponse.json({ error: "bad agent/kind" }, { status: 400 });
  }

  const res = await appendMemory({
    agent: agent as "claude" | "openclaw" | "hermes" | "user" | "system",
    kind: kind as "chat" | "goal" | "journal" | "note",
    user, reply, text,
  });
  return NextResponse.json(res);
}
