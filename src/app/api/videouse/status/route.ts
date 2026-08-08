import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { jobDir, jobRunning } from "@/lib/videouse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Pull the human-readable narration out of Claude Code's stream-json log:
// assistant text blocks + tool names, last N entries.
function digestLog(raw: string, max = 40): string[] {
  const out: string[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let e: Record<string, unknown>;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.type === "assistant") {
      const msg = (e.message ?? {}) as { content?: Array<Record<string, unknown>> };
      for (const b of msg.content ?? []) {
        if (b.type === "text" && String(b.text ?? "").trim()) out.push(String(b.text).trim());
        if (b.type === "tool_use") out.push(`⚙ ${String(b.name ?? "tool")}`);
      }
    }
    if (e.type === "result") {
      out.push(e.is_error ? `✕ finished with error` : `✓ finished — cost $${Number(e.total_cost_usd ?? 0).toFixed(2)}`);
    }
  }
  return out.slice(-max);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const job = url.searchParams.get("job") || "";
  let dir: string;
  try { dir = jobDir(job); } catch { return NextResponse.json({ error: "bad job" }, { status: 400 }); }
  if (!existsSync(dir)) return NextResponse.json({ error: "no such job" }, { status: 404 });

  const running = jobRunning(dir);
  let log: string[] = [];
  try { log = digestLog(await readFile(path.join(dir, "run.log"), "utf8")); } catch { /* no log yet */ }

  // outputs: any mp4 under edit/ plus project.md summary
  const outputs: Array<{ rel: string; bytes: number; mtime: number }> = [];
  const editDir = path.join(dir, "edit");
  if (existsSync(editDir)) {
    for (const f of await readdir(editDir)) {
      if (f.endsWith(".mp4")) {
        const s = await stat(path.join(editDir, f));
        outputs.push({ rel: `edit/${f}`, bytes: s.size, mtime: s.mtimeMs });
      }
    }
  }
  let summary = "";
  try { summary = await readFile(path.join(editDir, "project.md"), "utf8"); } catch { /* none */ }

  let instruction = "";
  try { instruction = await readFile(path.join(dir, "instruction.txt"), "utf8"); } catch { /* none */ }

  return NextResponse.json({ job, running, log, outputs, summary: summary.slice(-4000), instruction });
}
