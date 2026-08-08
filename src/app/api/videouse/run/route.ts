import { writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { jobDir, jobRunning, spawnEdit } from "@/lib/videouse";
import { checkLocalRequest } from "@/lib/localOnly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { job, instruction } → spawn a detached Claude Code run with the
// video-use skill in the job folder. Returns immediately; poll /status.
export async function POST(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  let body: { job?: unknown; instruction?: unknown };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Body must be JSON." }, { status: 400 }); }
  const { job, instruction } = body;
  if (typeof job !== "string" || typeof instruction !== "string" || !instruction.trim()) {
    return NextResponse.json({ error: "need job + instruction" }, { status: 400 });
  }
  let dir: string;
  try { dir = jobDir(job); } catch { return NextResponse.json({ error: "bad job" }, { status: 400 }); }
  if (jobRunning(dir)) return NextResponse.json({ error: "job already running" }, { status: 409 });

  const pid = spawnEdit(dir, instruction);
  await writeFile(path.join(dir, "run.pid"), String(pid));
  await writeFile(path.join(dir, "instruction.txt"), instruction.trim());
  return NextResponse.json({ ok: true, pid });
}
