import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { spawnStream } from "@/lib/runner";
import { chatSpawnOptions } from "@/lib/builders/spawn";
import { parseChunk, LineBuffer } from "@/lib/builders/protocol";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KIMI_SCRATCH_ROOT = process.env.AGENTIC_OS_KIMI_SCRATCH
  ?? path.join(os.homedir(), ".agentic-os", "kimi-projects");

async function ensureKimiProject(name: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_.-]+$/.test(name)) return null;
  if (!existsSync(KIMI_SCRATCH_ROOT)) await mkdir(KIMI_SCRATCH_ROOT, { recursive: true });
  const dir = path.join(KIMI_SCRATCH_ROOT, name);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  return dir;
}

// Kimi Code chat — `kimi -p "<prompt>" --output-format stream-json` runs one
// turn non-interactively and emits NDJSON. Kimi's events look like:
//   {"role":"assistant","content":"..."}                    — the answer
//   {"role":"meta","type":"session.resume_hint","session_id":...}
// We translate them into a tiny envelope the KimiView reads:
//   {"t":"d","c":"chunk"}  · {"t":"done"}  · {"t":"error","m":"..."}
//
// Kimi runs single-shot per invocation (like codex / claude -p), so we pack
// prior turns into the prompt for multi-turn memory.
interface ChatMsg { role: "user" | "assistant" | "system"; text: string; }

function buildPromptWithHistory(history: ChatMsg[], current: string): string {
  if (!history.length) return current;
  const recent = history.slice(-24);
  const lines: string[] = [
    "The following is the prior conversation between you and the user.",
    "Read it, then answer the user's latest message at the bottom.",
    "",
    "--- prior conversation ---",
  ];
  let bytes = 0;
  const MAX_BYTES = 8000;
  for (const m of recent) {
    const role = m.role === "user" ? "User" : m.role === "assistant" ? "Assistant" : "System";
    const line = `${role}: ${m.text}`;
    if (bytes + line.length > MAX_BYTES) { lines.push("…[earlier turns trimmed]"); break; }
    lines.push(line);
    bytes += line.length;
  }
  lines.push("--- end prior conversation ---", "", `User: ${current}`, "Assistant:");
  return lines.join("\n");
}

// Pull display text out of a Kimi assistant event's `content` (string or blocks).
// Kimi stream decoding lives in lib/builders/protocol.ts — this route only maps
// NormalizedEvents onto the tiny envelope the KimiView reads.

export async function POST(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  let body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Body must be JSON." }, { status: 400 }); }
  const prompt = body.prompt;
  const model = typeof body.model === "string" && /^[A-Za-z0-9._:/-]+$/.test(body.model) ? body.model : null;
  const history: ChatMsg[] = Array.isArray(body.history) ? body.history : [];
  if (typeof prompt !== "string" || prompt.length === 0) {
    return new Response("missing prompt", { status: 400 });
  }
  if (prompt.length > 16_000) {
    return new Response("prompt too long", { status: 413 });
  }
  const fullPrompt = buildPromptWithHistory(history, prompt);

  // Pin Kimi's cwd to a scratch project so anything it writes (HTML, scripts,
  // assets) lands somewhere the Workspace tab + preview route can serve.
  let cwd: string | undefined;
  if (typeof body.project === "string" && /^[A-Za-z0-9_.-]+$/.test(body.project)) {
    cwd = (await ensureKimiProject(body.project)) ?? undefined;
  } else if (typeof body.cwd === "string") {
    cwd = body.cwd;
  } else {
    cwd = (await ensureKimiProject("kimi-default")) ?? path.join(KIMI_SCRATCH_ROOT, "kimi-default");
  }

  // An optional Builder profile decides which Kimi account answers. Omitted, the
  // tab behaves exactly as it always has.
  let builder: Awaited<ReturnType<typeof chatSpawnOptions>>;
  try { builder = await chatSpawnOptions(body.builderId, "kimi"); }
  catch (e) {
    return new Response(JSON.stringify({ t: "error", m: String(e instanceof Error ? e.message : e) }) + "\n",
      { status: 400, headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } });
  }

  // `-p` is single-shot non-interactive; stream-json emits one JSON object per line.
  // (-y / --auto are rejected in prompt mode — prompt mode is already non-interactive.)
  const args = ["-p", fullPrompt, "--output-format", "stream-json"];
  const chosenModel = model ?? builder.model ?? null;
  if (chosenModel) args.push("--model", chosenModel);

  let child;
  try {
    child = spawnStream("kimi", args, {
      cwd,
      binOverride: builder.binOverride,
      argsPrefix: builder.argsPrefix,
      extraEnv: builder.extraEnv,
    });
  } catch (e) {
    return new Response(JSON.stringify({ t: "error", m: String(e) }) + "\n",
      { status: 503, headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let emitted = false;
      let stderrBuf = "";
      const send = (obj: unknown) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n")); }
        catch { closed = true; }
      };
      const safeClose = () => { if (closed) return; closed = true; try { controller.close(); } catch {} };

      const lines = new LineBuffer();
      // Kimi's NDJSON stream decodes into NormalizedEvents in one place for
      // every consumer (see lib/builders/protocol.ts); here we only decide
      // which of them the chat view shows.
      const handleLine = (line: string) => {
        for (const ev of parseChunk(line, "kimi-stream-json")) {
          if (ev.type === "text" && ev.text) { emitted = true; send({ t: "d", c: ev.text }); }
          else if (ev.type === "tool_use") {
            // surface tool activity so long builds don't look frozen
            let target = ev.detail ?? "";
            if (target.length > 60) target = target.slice(0, 57) + "…";
            send({ t: "s", c: target ? `${ev.name} · ${target}` : (ev.name ?? "tool") });
          } else if (ev.type === "status" && ev.text) {
            // A tool result's first line is enough to show what happened.
            send({ t: "s", c: ev.text.split("\n")[0].slice(0, 90) });
          }
          // meta / session hints and everything else are ignored for the chat view.
        }
      };

      child.stdout.on("data", (b: Buffer) => {
        for (const l of lines.push(b.toString())) handleLine(l);
      });
      child.stderr.on("data", (b: Buffer) => { stderrBuf += b.toString(); });
      child.on("close", (code) => {
        const rest = lines.flush();
        if (rest) handleLine(rest);
        if (!emitted) {
          const msg = stderrBuf.trim().slice(-400) || `Kimi exited with code ${code} and no output.`;
          send({ t: "error", m: msg });
        }
        send({ t: "done", code });
        safeClose();
      });
      child.on("error", (e) => { send({ t: "error", m: String(e) }); safeClose(); });
    },
    cancel() { try { child.kill("SIGTERM"); } catch {} },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
