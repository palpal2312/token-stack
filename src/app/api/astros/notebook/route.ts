import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One-click NotebookLM handoff: create a notebook for an Astros topic and load the
// competitor videos in as YouTube sources. Uses the local `nlm` CLI (already
// authenticated via `nlm login`). Returns the notebook URL.
// Note: nlm is not an AgentName in lib/runner, so we spawn it directly.

const NLM = existsSync(path.join(os.homedir(), ".local", "bin", "nlm"))
  ? path.join(os.homedir(), ".local", "bin", "nlm")
  : "nlm";

function nlm(args: string[], timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(NLM, args, { timeout: timeoutMs, cwd: os.homedir(), env: { ...process.env, NO_COLOR: "1" }, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => resolve({ code: err ? 1 : 0, stdout: String(stdout || ""), stderr: String(stderr || err?.message || "") }));
  });
}

export async function POST(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const body = await req.json().catch(() => ({}));
  const topic = String(body.topic || "").slice(0, 120);
  const urls: string[] = (Array.isArray(body.urls) ? body.urls : [])
    .map((u: unknown) => String(u))
    .filter((u: string) => /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[\w-]{6,}/.test(u))
    .slice(0, 6);
  if (!topic) return Response.json({ ok: false, error: "No topic given." }, { status: 400 });
  try {
    const create = await nlm(["notebook", "create", `Astros — ${topic}`, "--json"], 90_000);
    const out = create.stdout.trim();
    const jsonStart = out.indexOf("{");
    let parsed: Record<string, unknown> = {};
    try { parsed = jsonStart >= 0 ? JSON.parse(out.slice(jsonStart)) : {}; } catch { /* fall through */ }
    const id = String(parsed.id || parsed.notebook_id || parsed.notebookId || "");
    if (!id) return Response.json({ ok: false, error: `Couldn't create the notebook: ${(create.stderr || out).slice(-180) || "no id returned"}. Is nlm logged in? (nlm login)` }, { status: 500 });
    let sourcesAdded = 0;
    if (urls.length) {
      const add = await nlm(["source", "add", id, ...urls.flatMap((u) => ["--youtube", u])], 180_000);
      if (add.code === 0) sourcesAdded = urls.length;
    }
    return Response.json({ ok: true, id, url: `https://notebooklm.google.com/notebook/${id}`, sourcesAdded });
  } catch (e) {
    return Response.json({ ok: false, error: String((e as Error)?.message || e) }, { status: 500 });
  }
}
