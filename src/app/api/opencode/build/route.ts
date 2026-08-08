import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { checkLocalRequest } from "@/lib/localOnly";
import { OPENCODE_BIN, OPENCODE_ROOT, OPENCODE_DEFAULT_MODEL } from "@/lib/opencode";
import { appendOpenCodeHistory } from "@/lib/opencodeHistory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The dev server is often launched detached (launchd) with a minimal PATH. Prepend
// the usual bin dirs — plus ~/.opencode/bin where the opencode binary lives — so the
// spawn always resolves it regardless of how the server started.
const BIN_PATH = [
  path.join(os.homedir(), ".opencode/bin"),
  path.join(os.homedir(), ".local/bin"),
  "/opt/homebrew/bin",
  "/usr/local/bin",
  process.env.PATH || "",
].filter(Boolean).join(":");

// opencode tool names are lowercase; map them to the display names the terminal UI
// already knows how to render (Write/Edit/Read/Bash/TodoWrite).
const TOOL_MAP: Record<string, string> = {
  write: "Write", edit: "Edit", read: "Read", bash: "Bash", todowrite: "TodoWrite",
  glob: "Glob", grep: "Grep", list: "List", webfetch: "WebFetch", task: "Task", patch: "Edit",
};
const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function slugify(s: string): string {
  return (s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "build");
}

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
  // provider/model, where model may itself contain slashes (e.g. tinker/thinkingmachines/Inkling)
  const modelId = (typeof model === "string" && /^[\w.\-]+\/[\w.\-:/]+$/.test(model)) ? model : OPENCODE_DEFAULT_MODEL;

  const name = (typeof project === "string" && /^[a-z0-9-]{1,48}$/.test(project))
    ? project
    : `${slugify(prompt)}-${Date.now().toString(36).slice(-5)}`;
  const cwd = path.join(OPENCODE_ROOT, name);
  await mkdir(cwd, { recursive: true });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const emit = (obj: Record<string, unknown>) => {
        try { controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n")); } catch { /* closed */ }
      };

      emit({ type: "start", project: name, model: modelId, cwd });
      emit({ type: "system", model: modelId });

      let resOk = false, resCost = 0, resTurns = 0;
      const startedAt = Date.now();

      // A short steer so opencode writes real, previewable files into cwd. Web builds
      // should be a single self-contained index.html (no external build step).
      const STEER =
        "You are a build agent. Build exactly what the user asks as real files in the current working directory. " +
        "For a web build, write a complete, working, self-contained index.html (inline CSS/JS, no build step). " +
        "Create the files now with your tools, then stop.";

      const args = [
        "run",
        `${STEER}\n\n${prompt.trim()}`,
        "--model", modelId,
        "--dir", cwd,
        "--dangerously-skip-permissions",
        "--format", "json",
      ];
      const child = spawn(OPENCODE_BIN, args, {
        cwd,
        env: { ...process.env, PATH: BIN_PATH, NO_COLOR: "1" },
      });
      try { child.stdin?.end(); } catch {}

      const handleLine = (line: string) => {
        if (!line.trim()) return;
        let e: Record<string, unknown>;
        try { e = JSON.parse(line); } catch { return; }
        const t = e.type as string | undefined;
        const part = (e.part ?? {}) as Record<string, unknown>;
        if (t === "tool_use" && part.type === "tool") {
          const st = (part.state ?? {}) as Record<string, unknown>;
          if (st.status !== "completed") return;               // only the final state — dedupes pending/running
          const raw = String(part.tool ?? "");
          const disp = TOOL_MAP[raw] || title(raw);
          const inp = (st.input ?? {}) as Record<string, unknown>;
          emit({ type: "tool", name: disp, input: { file_path: inp.filePath ?? inp.path, command: inp.command, ...inp } });
          const out = String(st.output ?? "").trim();
          if (out) emit({ type: "tool_result", text: out.slice(0, 400) });
        } else if (t === "text" && part.type === "text") {
          const txt = String(part.text ?? "").trim();
          if (txt) emit({ type: "text", text: txt });
        } else if (t === "step_finish") {
          resCost += Number(part.cost ?? 0) || 0;
          resTurns += 1;
        } else if (t === "error" || (t === "text" && part.type === "error")) {
          const m = String((e.message ?? part.text) ?? "").slice(0, 240);
          if (m) emit({ type: "error", text: m });
        }
      };

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
        if (!s) return;
        emit({ type: "stderr", text: s.slice(0, 300) });
      });
      child.on("error", (err) => { emit({ type: "error", text: String(err).slice(0, 200) }); });
      child.on("close", (code) => {
        clearTimeout(killer);
        if (buf.trim()) handleLine(buf);
        resOk = code === 0;
        const ms = Date.now() - startedAt;
        emit({ type: "result", subtype: resOk ? "success" : "error", cost: resCost, turns: resTurns, ms });
        appendOpenCodeHistory({ ts: Date.now(), prompt: prompt.trim(), project: name, ok: resOk, cost: resCost, turns: resTurns, ms, model: modelId }).catch(() => {});
        emit({ type: "done", code: code ?? 0, project: name });
        try { controller.close(); } catch {}
      });

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
