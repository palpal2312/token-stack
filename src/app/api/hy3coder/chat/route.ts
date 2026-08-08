import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { hermesHome } from "@/lib/config";
import { checkLocalRequest } from "@/lib/localOnly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/hy3coder/chat  { messages: [{role,content}] }
// Calls Tencent Hy3 (Hunyuan 3, Apache-2.0) through OpenRouter and returns the
// full reply. Hy3 is a cheap, strong open-weights coder — great for one-shot
// single-file builds that preview live on the right. Key resolved the same way
// as the MoA tab (env → ~/.hermes/auth.json → hermes .env files).

const MODEL = "tencent/hy3";
const OR_URL = "https://openrouter.ai/api/v1/chat/completions";

function orKey(): string | null {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY.trim();
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(hermesHome(), "auth.json"), "utf8"));
    const v = raw.openrouter;
    const k = typeof v === "string" ? v : v?.api_key;
    if (k) return String(k).trim();
    // some profiles nest it under an array with {source:"env:..."} — fall through to files
  } catch { /* ignore */ }
  for (const file of [
    path.join(hermesHome(), "profiles", "julian", ".env"),
    path.join(hermesHome(), "profiles", "fusion", ".env"),
    path.join(hermesHome(), ".env"),
  ]) {
    try {
      const m = fs.readFileSync(file, "utf8").match(/^OPENROUTER_API_KEY=(.+)$/m);
      if (m) return m[1].trim();
    } catch { /* ignore */ }
  }
  return null;
}

// Steer Hy3 to ship a complete single-file build immediately (it can over-explain).
const STEER =
  "You are Hy3, a fast senior build engineer. When asked to build something visual, " +
  "output ONE complete, self-contained HTML document (inline CSS + JS) in a single ```html code block, " +
  "and nothing else. It must render immediately on load, be well-lit and colourful (never blank/black), " +
  "and if interactive, wire REAL keyboard/mouse controls. For 3D use three.js r128 UMD from " +
  "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js. End with </body></html>.";

export async function POST(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const key = orKey();
  if (!key) return NextResponse.json({ error: "No OpenRouter key found (checked env + ~/.hermes). Add OPENROUTER_API_KEY." }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  const messages = Array.isArray(body.messages) ? body.messages : null;
  if (!messages || !messages.length) return NextResponse.json({ error: "messages required" }, { status: 400 });
  const withSteer = messages[0]?.role === "system" ? messages : [{ role: "system", content: STEER }, ...messages];

  // Hy3's OpenRouter upstream is SLOW (often 60-180s to finish). We STREAM so the panel
  // shows tokens as they arrive instead of a dead spinner. Output is a plain text/event-stream
  // of {delta} JSON lines, then a final {done, model}.
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 600_000); // generous — big builds take minutes
  let upstream: Response;
  try {
    upstream = await fetch(OR_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://agentos.guide",
        "X-Title": "Agent OS · Hy3 Coder",
      },
      body: JSON.stringify({ model: MODEL, messages: withSteer, max_tokens: 32000, temperature: 0.6, stream: true }),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(t);
    const msg = (e as Error).name === "AbortError" ? "Hy3 timed out (slow upstream) — try again." : String((e as Error).message).slice(0, 160);
    return NextResponse.json({ error: msg }, { status: 504 });
  }
  if (!upstream.ok || !upstream.body) {
    clearTimeout(t);
    let em = `HTTP ${upstream.status}`;
    try { const j = await upstream.json(); em = j?.error?.message || em; } catch { /* ignore */ }
    return NextResponse.json({ error: em }, { status: 502 });
  }

  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      let buf = "";
      let full = "";
      let model = MODEL;
      try {
        const reader = upstream.body!.getReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() || "";
          for (const line of lines) {
            const s = line.trim();
            if (!s.startsWith("data:")) continue;
            const data = s.slice(5).trim();
            if (data === "[DONE]") continue;
            try {
              const j = JSON.parse(data);
              if (j.model) model = j.model;
              const delta = j?.choices?.[0]?.delta?.content;
              if (typeof delta === "string" && delta) { full += delta; send({ delta }); }
            } catch { /* skip keep-alive / partial */ }
          }
        }
        if (!full.trim()) send({ error: "Hy3 came back empty — try again." });
        else send({ done: true, model });
      } catch (e) {
        send({ error: (e as Error).name === "AbortError" ? "Hy3 timed out — try again." : String((e as Error).message).slice(0, 160) });
      } finally {
        clearTimeout(t);
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
