import { NextResponse } from "next/server";
import { spawnStream } from "@/lib/runner";
import { chatSpawnOptions } from "@/lib/builders/spawn";
import { codexApprovalArgs } from "@/lib/codexWorkspace";
import { checkLocalRequest } from "@/lib/localOnly";
import { omnirouteCodexArgs, openrouterCodexArgs, openrouterCodexEnv, OPENROUTER_HY3_MODEL, omnirouteCodexEnv, nativeCodexArgs, nativeCodexEnv, NATIVE_CODEX_MODEL, withSteer, probeOmniRoute } from "@/lib/omniroute";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CODEX_SCRATCH_ROOT = process.env.AGENTIC_OS_CODEX_SCRATCH
  ?? path.join(os.homedir(), "codex-scratch");

async function ensureCodexProject(name: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_.-]+$/.test(name)) return null;
  if (!existsSync(CODEX_SCRATCH_ROOT)) await mkdir(CODEX_SCRATCH_ROOT, { recursive: true });
  const dir = path.join(CODEX_SCRATCH_ROOT, name);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  return dir;
}

// Codex streaming chat — `codex exec --json <prompt>` emits one JSON object per
// line on stdout for every event (assistant deltas, tool calls, results, etc).
// We just forward the NDJSON to the browser, same shape as our other agents.
//
// Codex behaves like `claude -p`: single-shot per invocation. For multi-turn
// memory we pack prior history into the prompt (same trick used by FreeClaude).
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

export async function POST(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  let body: Record<string, unknown>;
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

  // Pin Codex's cwd to a scratch project so anything it writes (HTML, scripts,
  // generated assets) lands somewhere the Workspace tab can find. Same pattern
  // as the Free Claude Code chat endpoint.
  let cwd: string | undefined;
  if (typeof body.project === "string" && /^[A-Za-z0-9_.-]+$/.test(body.project)) {
    cwd = (await ensureCodexProject(body.project)) ?? undefined;
  } else if (typeof body.cwd === "string") {
    cwd = body.cwd;
  } else {
    cwd = (await ensureCodexProject("codex-default")) ?? path.join(CODEX_SCRATCH_ROOT, "codex-default");
  }

  // Engine selection:
  //  • "hy3"   → direct OpenRouter, tencent/hy3:free (Tencent's 295B, free window)
  //  • "gpt56" → native OpenAI Codex on the user's ChatGPT OAuth login (gpt-5.6)
  //  • default → local OmniRoute gateway (90+ free providers)
  const engine = body.engine === "hy3" ? "hy3" : body.engine === "gpt56" ? "gpt56" : "omniroute";

  if (engine === "omniroute" && !(await probeOmniRoute())) {
    return new Response(
      JSON.stringify({ type: "error", message: "OmniRoute isn't running on :20128. Open the OmniRoute tab (or run `omniroute`), then try again." }) + "\n",
      { status: 503, headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } },
    );
  }
  if (engine === "hy3" && !process.env.OPENROUTER_API_KEY) {
    return new Response(
      JSON.stringify({ type: "error", message: "OPENROUTER_API_KEY is missing from the server env — add it to .env.local and restart the OS." }) + "\n",
      { status: 503, headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } },
    );
  }

  // Codex runs non-interactively here, so its terminal approval prompt can't be
  // answered from the browser — pass an explicit approval policy or it blocks.
  const providerArgs = engine === "hy3"
    ? openrouterCodexArgs(model || OPENROUTER_HY3_MODEL)
    : engine === "gpt56"
    ? nativeCodexArgs(model || NATIVE_CODEX_MODEL)
    : omnirouteCodexArgs(model);
  const args = ["exec", "--json", "--skip-git-repo-check",
    ...codexApprovalArgs(body.approvalMode),
    ...providerArgs,
  ];
  args.push(withSteer(fullPrompt));

  const extraEnv = engine === "hy3" ? openrouterCodexEnv() : engine === "gpt56" ? nativeCodexEnv() : omnirouteCodexEnv();

  // An optional Builder profile picks which Codex account answers. Its env is
  // applied over the engine's, so a profile can point CODEX_HOME at its own
  // login while the engine still supplies the provider settings.
  let builder: Awaited<ReturnType<typeof chatSpawnOptions>>;
  try { builder = await chatSpawnOptions(body.builderId, "codex"); }
  catch (e) {
    return new Response(JSON.stringify({ t: "error", m: String(e instanceof Error ? e.message : e) }) + "\n",
      { status: 400, headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } });
  }

  const child = spawnStream("codex", args, {
    cwd,
    extraEnv: { ...extraEnv, ...(builder.extraEnv ?? {}) },
    binOverride: builder.binOverride,
    argsPrefix: builder.argsPrefix,
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (chunk: string) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(chunk)); }
        catch { closed = true; }
      };
      const safeClose = () => {
        if (closed) return;
        closed = true;
        try { controller.close(); } catch {}
      };
      child.stdout.on("data", (b: Buffer) => send(b.toString()));
      child.stderr.on("data", (b: Buffer) => {
        const text = b.toString();
        // Codex still pings its (unused) OpenAI OAuth refresh on startup even when
        // running on the OmniRoute provider — pure noise here, don't show the user.
        if (/codex_login|refresh token|auth::manager|log out and sign in/i.test(text)) return;
        send(JSON.stringify({ type: "stderr", text }) + "\n");
      });
      child.on("close", (code) => {
        send(JSON.stringify({ type: "done", code }) + "\n");
        safeClose();
      });
      child.on("error", (e) => {
        send(JSON.stringify({ type: "error", message: String(e) }) + "\n");
        safeClose();
      });
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
