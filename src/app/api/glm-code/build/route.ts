import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { checkLocalRequest } from "@/lib/localOnly";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { glmcodeSpawnEnv, GLM_CODE_MODEL, kimik3SpawnEnv, KIMI_K3_MODEL } from "@/lib/glmcode";
import { appendGlmHistory } from "@/lib/glmCodeHistory";
import { config } from "@/lib/config";
import { codexApprovalArgs } from "@/lib/codexWorkspace";
import { nativeCodexArgs, nativeCodexEnv, NATIVE_CODEX_MODEL } from "@/lib/omniroute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The dev server is often launched detached (launchd) with a minimal PATH that
// excludes ~/.local/bin (where `claude` lives) and Homebrew. Prepend them so the
// spawn always resolves `claude` / `codex`, regardless of how the server started.
const BIN_PATH = [
  path.join(os.homedir(), ".local/bin"),
  "/opt/homebrew/bin",
  "/usr/local/bin",
  path.join(os.homedir(), ".npm-global/bin"),
  process.env.PATH || "",
].filter(Boolean).join(":");

const ROOT = path.join(os.homedir(), ".agentic-os", "glm-code", "builds");

// Model tag → what actually runs. "gpt56" is the default: OpenAI Codex on the
// user's ChatGPT OAuth login (gpt-5.6-sol), no API key. "glm" keeps the original
// Claude-Code-on-GLM-5.2 path. Both build into the SAME workspace dir.
const GPT56_LABEL = "gpt-5.6-sol";

function slugify(s: string): string {
  return (s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "build");
}

// A short builder steer so Codex writes a real, previewable file into cwd instead
// of just describing what it would do. gpt-5.6 doesn't loop like the free models,
// so this stays minimal.
const CODEX_BUILDER_STEER =
  "You are a build agent. Build exactly what the user asks as real files in the current working directory. " +
  "If it's a web build, write a complete, working, self-contained index.html (inline CSS/JS, no external build step). " +
  "Create the files now with your tools, then stop. Keep chatter short.";

export async function POST(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Body must be JSON." }, { status: 400 }); }
  const { prompt, project, model } = body;
  if (typeof prompt !== "string" || !prompt.trim()) {
    return new Response(JSON.stringify({ error: "missing prompt" }), { status: 400 });
  }
  // Default to GPT 5.6 (the default); "glm" opts into the GLM-5.2 path.
  const engine: "gpt56" | "glm" | "kimik3" | "qoder" =
    model === "glm" ? "glm" : model === "kimik3" ? "kimik3" : model === "qoder" ? "qoder" : "gpt56";
  const modelLabel = engine === "gpt56" ? GPT56_LABEL : engine === "kimik3" ? "kimi-k3" : engine === "qoder" ? "qwen3.8-max" : GLM_CODE_MODEL;

  // Each build gets its own project dir so the agent can read/write freely.
  const name = (typeof project === "string" && /^[a-z0-9-]{1,48}$/.test(project))
    ? project
    : `${engine === "gpt56" ? "gpt56-" : ""}${slugify(prompt)}-${Date.now().toString(36).slice(-5)}`;
  const cwd = path.join(ROOT, name);
  await mkdir(cwd, { recursive: true });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const emit = (obj: Record<string, unknown>) => {
        try { controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n")); } catch { /* closed */ }
      };

      emit({ type: "start", project: name, model: modelLabel, cwd });

      // captured from the final result event so we can log it (history + Obsidian)
      let resOk = false, resCost: number | undefined, resTurns: number | undefined, resMs: number | undefined;
      const startedAt = Date.now();

      // ── choose the child + its line parser ──────────────────────────────────
      let child: ReturnType<typeof spawn>;
      let handleLine: (line: string) => void;

      if (engine === "gpt56") {
        // OpenAI Codex on the ChatGPT OAuth login. `codex exec --json` emits one
        // JSON event per line: { type:"item.completed", item:{ type, text, ... } }.
        const bin = config.codex || "codex";
        const args = [
          "exec", "--json", "--skip-git-repo-check",
          ...codexApprovalArgs("auto"),        // never prompt; sandbox to cwd
          ...nativeCodexArgs(NATIVE_CODEX_MODEL), // -c model_provider=openai --model gpt-5.6-sol
          `${CODEX_BUILDER_STEER}\n\n${prompt.trim()}`,
        ];
        emit({ type: "system", model: modelLabel, tools: undefined });
        child = spawn(bin, args, {
          cwd,
          env: { ...process.env, ...nativeCodexEnv(), PATH: BIN_PATH, NO_COLOR: "1" },
        });
        // codex exec reads stdin if it's left open (non-TTY) — close it so it uses
        // the prompt arg instead of hanging on "Reading additional input from stdin".
        try { child.stdin?.end(); } catch {}
        handleLine = (line: string) => {
          if (!line.trim()) return;
          let e: Record<string, unknown>;
          try { e = JSON.parse(line); } catch { return; }
          const t = e.type as string | undefined;
          const item = (e.item ?? {}) as Record<string, unknown>;
          const it = item.type as string | undefined;
          if (t === "item.completed" && it === "agent_message" && typeof item.text === "string") {
            if (item.text.trim()) emit({ type: "text", text: item.text });
          } else if (t === "item.completed" && it === "command_execution") {
            const cmd = String(item.command ?? item.parsed_cmd ?? "").slice(0, 80);
            if (cmd) emit({ type: "tool", name: "Bash", input: { command: cmd } });
            const out = String(item.aggregated_output ?? item.output ?? "").trim();
            if (out) emit({ type: "tool_result", text: out.slice(0, 400) });
          } else if (t === "item.completed" && (it === "file_change" || it === "patch_apply")) {
            const changes = Array.isArray(item.changes) ? item.changes : [];
            for (const c of changes) {
              const p = String((c as Record<string, unknown>).path ?? "").split("/").pop() ?? "";
              if (p) emit({ type: "tool", name: "Write", input: { file_path: p } });
            }
          } else if (t === "error" && e.message) {
            emit({ type: "error", text: String(e.message).slice(0, 240) });
          }
        };
      } else if (engine === "qoder") {
        // Qoder CLI (Alibaba) pinned to Qwen3.8-Max-Preview via the ~/.local/bin/qoder-qwen
        // wrapper. It's a full agent that writes files itself; stdout is PLAIN TEXT (no JSON
        // stream), so every non-empty line is surfaced as a text event and the result is
        // synthesized from the exit code on close (same as the codex path).
        const args = [
          "-p", `${CODEX_BUILDER_STEER}\n\n${prompt.trim()}`,
          "--permission-mode", "bypass_permissions",
          "-w", cwd,
        ];
        emit({ type: "system", model: modelLabel, tools: undefined });
        child = spawn("qoder-qwen", args, {
          cwd,
          env: { ...process.env, PATH: BIN_PATH, NO_COLOR: "1" },
        });
        try { child.stdin?.end(); } catch {}
        handleLine = (line: string) => {
          const t = line.replace(/\x1b\[[0-9;]*m/g, "").trimEnd();
          if (t.trim()) emit({ type: "text", text: t });
        };
      } else {
        // Original path: the real Claude Code harness driven by GLM-5.2 (Ollama).
        const args = [
          "-p", prompt.trim(),
          "--output-format", "stream-json",
          "--verbose",
          "--permission-mode", "bypassPermissions",
          "--model", engine === "kimik3" ? KIMI_K3_MODEL : GLM_CODE_MODEL,
        ];
        const spawnEnv = engine === "kimik3" ? kimik3SpawnEnv() : glmcodeSpawnEnv();
        child = spawn("claude", args, { cwd, env: { ...process.env, ...spawnEnv, PATH: BIN_PATH } });
        try { child.stdin?.end(); } catch {}
        handleLine = (line: string) => {
          if (!line.trim()) return;
          let e: Record<string, unknown>;
          try { e = JSON.parse(line); } catch { return; }
          const t = e.type;
          if (t === "assistant") {
            const msg = (e.message ?? {}) as { content?: Array<Record<string, unknown>> };
            for (const b of msg.content ?? []) {
              if (b.type === "text" && String(b.text ?? "").trim()) emit({ type: "text", text: b.text });
              else if (b.type === "tool_use") emit({ type: "tool", name: b.name, input: b.input });
            }
          } else if (t === "user") {
            const msg = (e.message ?? {}) as { content?: Array<Record<string, unknown>> };
            for (const b of msg.content ?? []) {
              if (b.type === "tool_result") {
                const c = b.content;
                const text = Array.isArray(c) ? c.map((x) => (x as { text?: string }).text ?? "").join("") : String(c ?? "");
                emit({ type: "tool_result", text: text.slice(0, 400) });
              }
            }
          } else if (t === "result") {
            resOk = e.subtype === "success"; resCost = e.total_cost_usd as number; resTurns = e.num_turns as number; resMs = e.duration_ms as number;
            emit({ type: "result", subtype: e.subtype, cost: e.total_cost_usd, turns: e.num_turns, ms: e.duration_ms, result: typeof e.result === "string" ? (e.result as string).slice(0, 600) : undefined });
          } else if (t === "system" && e.subtype === "init") {
            emit({ type: "system", model: e.model, tools: Array.isArray(e.tools) ? (e.tools as string[]).length : undefined });
          }
        };
      }

      // 12-minute hard cap so a stuck agentic loop can't run forever.
      const killer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 12 * 60_000);

      let buf = "";
      child.stdout!.on("data", (d: Buffer) => {
        buf += d.toString();
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) { handleLine(buf.slice(0, nl)); buf = buf.slice(nl + 1); }
      });
      child.stderr!.on("data", (d: Buffer) => {
        const s = d.toString().trim();
        // Codex pings its OAuth refresh on startup — pure noise, don't show it.
        if (!s || /codex_login|refresh token|auth::manager|log out and sign in/i.test(s)) return;
        emit({ type: "stderr", text: s.slice(0, 300) });
      });
      child.on("error", (err) => { emit({ type: "error", text: String(err).slice(0, 200) }); });
      child.on("close", (code) => {
        clearTimeout(killer);
        if (buf.trim()) handleLine(buf);
        // Codex/Qoder have no result event — synthesize one from the exit code so the UI
        // shows "Done". (The GLM path already emitted its own result above.)
        if (engine === "gpt56" || engine === "qoder") {
          resOk = code === 0; resMs = Date.now() - startedAt;
          emit({ type: "result", subtype: resOk ? "success" : "error", ms: resMs });
        }
        appendGlmHistory({ ts: Date.now(), prompt: prompt.trim(), project: name, ok: resOk, cost: resCost, turns: resTurns, ms: resMs, model: modelLabel }).catch(() => {});
        emit({ type: "done", code: code ?? 0, project: name });
        try { controller.close(); } catch {}
      });

      // Abort the child if the client disconnects.
      req.signal.addEventListener("abort", () => { try { child.kill("SIGKILL"); } catch {} });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
