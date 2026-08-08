import { NextResponse } from "next/server";
import { writeFile, readdir, readFile } from "node:fs/promises";
import { hermesHome } from "@/lib/config";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { FCC_SCRATCH_ROOT, ensureProject } from "@/lib/freeClaudeWorkspace";
import { spawnStream } from "@/lib/runner";
import { fccSpawnEnv } from "@/lib/fcc";
import { checkLocalRequest } from "@/lib/localOnly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Fast "speak → build" generation. We do NOT route through the Claude agentic
// CLI (its tool-use loop hangs local general models). Instead we ask a model for
// the HTML in ONE shot, stream the tokens to the UI, then write the file.
//
// Two engines:
//   • "local"  → on-device Ollama (the explicit $0 offline toggle — Gemma 4 MLX)
//   • "glm"    → GLM 5.2 via z.ai, with the REAL Claude CLI (the user's subscription)
//                as the quality fallback — voice builds must look amazing, so the
//                fallback is a frontier coder, never the small local model.
// (The old "n2" OpenRouter engine was removed 2026-07-03.)

const OLLAMA = process.env.OLLAMA_HOST || "http://localhost:11434";

function localModel(): string {
  try {
    const env = readFileSync(path.join(os.homedir(), ".fcc", ".env"), "utf8");
    const line = env.split("\n").find((l) => l.startsWith("MODEL="));
    if (line) {
      const v = line.slice(6).split("#")[0].trim().replace(/^["']|["']$/g, "").trim();
      if (v.startsWith("ollama/")) return v.slice("ollama/".length);
    }
  } catch { /* ignore */ }
  return "xentriom/gemma-4-12B-coder-fable5-composer2.5-v1";
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "build";
}

function extractHtml(text: string): string {
  const fence = text.match(/```(?:html)?\s*([\s\S]*?)```/i);
  let h = fence ? fence[1] : text;
  const start = h.search(/<!DOCTYPE html|<html/i);
  if (start > 0) h = h.slice(start);
  const end = h.toLowerCase().lastIndexOf("</html>");
  if (end !== -1) h = h.slice(0, end + 7);
  return h.trim();
}

async function uniqueFile(dir: string, slug: string): Promise<string> {
  let names: string[] = [];
  try { names = await readdir(dir); } catch { /* */ }
  let name = `${slug}.html`;
  let n = 2;
  while (names.includes(name)) { name = `${slug}-${n}.html`; n++; }
  return name;
}

const SYSTEM = "You are a world-class creative front-end developer. Output ONLY a single, complete, self-contained HTML file — vanilla JS + HTML5 canvas where useful, NO external libraries, no build step. CRITICAL: NO external resources of any kind — no external images, no <img src> to the web, no icon/image URLs, no web fonts, no CDNs, no network requests. Draw EVERY visual yourself with Canvas, CSS, SVG, gradients, shapes, or emoji so it works perfectly offline. It must be visually stunning, full-window, dark background, smooth 60fps. Start your output with <!DOCTYPE html> and output NOTHING else: no markdown fences, no explanation, no preamble.";

// ── GLM 5.2 (z.ai) — the reliable cloud build engine for voice Apollo ──
const GLM_ENDPOINT = "https://api.z.ai/api/coding/paas/v4/chat/completions";
const GLM_MODEL = "glm-5.2";
function glmKey(): string | null {
  const e = process.env.GLM_API_KEY || process.env.ZAI_API_KEY || process.env.Z_AI_API_KEY;
  if (e) return e.trim();
  try {
    const env = readFileSync(path.join(hermesHome(), "profiles", "glm-5-2", ".env"), "utf8");
    const m = env.match(/^(?:GLM_API_KEY|ZAI_API_KEY|Z_AI_API_KEY)=(.+)$/m);
    if (m) return m[1].trim();
  } catch { /* ignore */ }
  return null;
}

// GLM build prompt — z.ai's coding plan is slow (~18 tok/s) and cuts a request off
// at ~200s, so we steer GLM to finish a COMPLETE, compact file inside that window
// rather than a sprawling one that truncates before </html>.
const GLM_BUILD_SYS = SYSTEM + " CRITICAL CONSTRAINT: keep the whole file TIGHT — a complete, working app in roughly 120–200 lines. Never write more than you can finish; the document MUST end with </body></html>. A small complete app always beats a large unfinished one. Inline only the CSS and JS you actually need.";

// Stream GLM 5.2 (OpenAI-compatible SSE). Streaming keeps the connection alive (a
// non-streaming request to z.ai is dropped on long builds). Flushes the final
// buffered SSE line after the stream ends — otherwise the last chunk (which carries
// </html>) is lost. Returns the full text.
async function streamGlm(prompt: string, key: string, onTok: (c: string) => void): Promise<string> {
  let full = "";
  const r = await fetch(GLM_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: GLM_MODEL, stream: true, temperature: 0.7, max_tokens: 9000, messages: [{ role: "system", content: GLM_BUILD_SYS }, { role: "user", content: prompt }] }),
  });
  if (!r.ok || !r.body) { const t = await r.text().catch(() => ""); throw new Error(`z.ai ${r.status}: ${t.slice(0, 160)}`); }
  const reader = r.body.getReader(); const dec = new TextDecoder();
  const consume = (chunk: string) => {
    for (const line of chunk.split("\n")) {
      const s = line.trim(); if (!s.startsWith("data:")) continue;
      const data = s.slice(5).trim(); if (!data || data === "[DONE]") continue;
      try { const j = JSON.parse(data); const c = j?.choices?.[0]?.delta?.content; if (c) { full += c; onTok(c); } } catch { /* partial SSE */ }
    }
  };
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    const nl = buf.lastIndexOf("\n");
    if (nl >= 0) { consume(buf.slice(0, nl)); buf = buf.slice(nl + 1); }
  }
  if (buf.trim()) consume(buf); // flush the trailing line (carries the closing </html>)
  return full;
}

// Stream the on-device model (Ollama) — used directly for engine "local" and as the
// reliability fallback when a cloud engine returns nothing usable.
async function streamOllama(prompt: string, onTok: (c: string) => void): Promise<string> {
  let full = "";
  const r = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: localModel(), stream: true, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: prompt }], options: { num_predict: 4096, temperature: 0.7 } }),
  });
  if (!r.ok || !r.body) throw new Error(`ollama ${r.status}`);
  const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = "";
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n"); buf = lines.pop() ?? "";
    for (const line of lines) { if (!line.trim()) continue; try { const j = JSON.parse(line); const tok = j?.message?.content; if (tok) { full += tok; onTok(tok); } } catch { /* */ } }
  }
  return full;
}

// Quality fallback: build with the REAL Claude CLI (the user's own subscription).
// One-shot text mode — no agentic tool loop, just "write the HTML".
async function claudeBuild(prompt: string, cwd: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawnStream("claude", ["-p", "--output-format", "text", `${SYSTEM}\n\n${prompt}`], { cwd, extraEnv: fccSpawnEnv() });
    let out = "";
    const timer = setTimeout(() => { try { child.kill("SIGTERM"); } catch { /* */ } reject(new Error("claude build timeout")); }, 240_000);
    child.stdout.on("data", (b: Buffer) => { out += b.toString(); });
    child.on("close", () => { clearTimeout(timer); resolve(out); });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

export async function POST(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  let body: { prompt?: string; project?: string; engine?: string };
  try { body = await req.json(); } catch { return new Response("bad json", { status: 400 }); }
  const prompt = (body.prompt ?? "").toString().trim().slice(0, 2000);
  if (!prompt) return new Response("empty prompt", { status: 400 });

  const engine = body.engine === "glm" ? "glm" : "local";
  const fallbackProject = "free-claude-code";
  const projectName = typeof body.project === "string" && /^[A-Za-z0-9_.-]+$/.test(body.project)
    ? body.project : fallbackProject;
  const dir = (await ensureProject(projectName)) ?? path.join(FCC_SCRATCH_ROOT, projectName);

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (o: unknown) => { try { controller.enqueue(enc.encode(JSON.stringify(o) + "\n")); } catch { /* */ } };
      let full = "";
      const usage: unknown = null; // (was OpenRouter usage for the removed n2 engine)
      try {
        if (engine === "glm") {
          const gk = glmKey();
          if (!gk) { send({ t: "error", m: "No GLM key found (expected GLM_API_KEY in ~/.hermes/profiles/glm-5-2/.env)." }); controller.close(); return; }
          try { full = await streamGlm(prompt, gk, (c) => send({ t: "d", c })); } catch { /* fall through to the Claude CLI */ }
          // Reliability: empty OR truncated (no closing </html>) → fall back to the REAL
          // Claude CLI (the user's subscription) so voice builds stay frontier-quality.
          if (full.replace(/\s/g, "").length < 60 || !/<\/html>/i.test(full)) {
            // transient z.ai cutoffs usually succeed on a clean second attempt
            try { full = await streamGlm(prompt, gk, (c) => send({ t: "d", c })); } catch { /* next fallback */ }
          }
          if (full.replace(/\s/g, "").length < 60 || !/<\/html>/i.test(full)) {
            send({ t: "d", c: "\n" });
            try {
              full = await claudeBuild(prompt, dir);
              send({ t: "d", c: full.slice(0, 400) });
            } catch {
              // absolute last resort: on-device model (better a simple build than none)
              try {
                full = await streamOllama(prompt, (c) => send({ t: "d", c }));
              } catch {
                send({ t: "error", m: "GLM cut off, the Claude CLI fallback failed, and Ollama isn't running — try again." });
                controller.close(); return;
              }
            }
          }
        } else {
          const model = localModel();
          const r = await fetch(`${OLLAMA}/api/chat`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              model, stream: true, think: false,
              messages: [{ role: "system", content: SYSTEM }, { role: "user", content: prompt }],
              options: { num_predict: 9000, temperature: 0.7 },
            }),
          });
          if (!r.ok || !r.body) {
            send({ t: "error", m: `local model not reachable (ollama ${r.status}). Is Ollama running?` });
            controller.close(); return;
          }
          const reader = r.body.getReader();
          const dec = new TextDecoder();
          let buf = "";
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const lines = buf.split("\n");
            buf = lines.pop() ?? "";
            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const j = JSON.parse(line);
                const tok = j?.message?.content;
                if (tok) { full += tok; send({ t: "d", c: tok }); }
              } catch { /* */ }
            }
          }
        }
      } catch (e) {
        send({ t: "error", m: String(e).slice(0, 200) });
        controller.close(); return;
      }

      const html = extractHtml(full);
      if (!html || html.length < 40) {
        send({ t: "error", m: "model did not return usable HTML — try rephrasing." });
        controller.close(); return;
      }
      try {
        const file = await uniqueFile(dir, slugify(prompt));
        await writeFile(path.join(dir, file), html, "utf8");
        send({ t: "done", file, bytes: html.length, engine, project: projectName });
      } catch (e) {
        send({ t: "error", m: `could not save file: ${String(e).slice(0, 120)}` });
      }
      // (Token-usage logging removed with the n2 engine — local + GLM paths are untracked here.)
      void usage;
      controller.close();
    },
  });

  return new Response(stream, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
}

// avoid unused import lint
void existsSync;
