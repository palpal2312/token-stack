import { NextResponse } from "next/server";
import { apolloReply, type ApolloMsg } from "@/lib/hermesApollo";
import { checkLocalRequest } from "@/lib/localOnly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { prompt, mode?: "auto"|"fast"|"agent", history?: [{role,content}] }
//   auto  -> fast model answers / opens apps directly / escalates complex tasks  [default]
//   fast  -> direct OpenRouter completion, chat only (~2s)
//   agent -> full Hermes CLI, runs tools (~28s)
export async function POST(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  let body: { prompt?: string; mode?: string; history?: ApolloMsg[] };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, text: "", error: "bad json" }, { status: 400 }); }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return NextResponse.json({ ok: false, text: "", error: "missing prompt" }, { status: 400 });

  const mode: "auto" | "fast" | "agent" = body.mode === "agent" ? "agent" : body.mode === "fast" ? "fast" : "auto";
  const history = Array.isArray(body.history)
    ? body.history
        .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
        .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }))
    : [];

  const result = await apolloReply(prompt.slice(0, 4000), mode, history);
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
