import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The OmniRoute workspace lives on disk so builds + conversations survive
// restarts — same idea as the other Agent OS agents that persist to the vault.
const ROOT = path.join(os.homedir(), ".agentic-os", "omniroute-workspace");
const BUILDS = path.join(ROOT, "builds");
const SESSIONS = path.join(ROOT, "sessions");

async function ensure() {
  await fs.mkdir(BUILDS, { recursive: true });
  await fs.mkdir(SESSIONS, { recursive: true });
}
function slug(s: string) {
  return (s || "build").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "build";
}
function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}
const safe = (name: string) => path.basename(name); // never escape the dir

// GET                       → { builds:[...], sessions:[...] }
// GET ?open=<file>          → raw HTML of a saved build (for viewing in a tab)
// GET ?session=<id>         → the saved conversation JSON
export async function GET(req: Request) {
  await ensure();
  const url = new URL(req.url);
  const open = url.searchParams.get("open");
  if (open) {
    try {
      const html = await fs.readFile(path.join(BUILDS, safe(open)), "utf8");
      return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    } catch { return NextResponse.json({ error: "not found" }, { status: 404 }); }
  }
  const sid = url.searchParams.get("session");
  if (sid) {
    try {
      const j = await fs.readFile(path.join(SESSIONS, safe(sid) + ".json"), "utf8");
      return NextResponse.json(JSON.parse(j));
    } catch { return NextResponse.json({ error: "not found" }, { status: 404 }); }
  }
  const listDir = async (dir: string, ext: string) => {
    const files = (await fs.readdir(dir).catch(() => [])).filter((f) => f.endsWith(ext));
    const out = await Promise.all(files.map(async (f) => {
      const st = await fs.stat(path.join(dir, f));
      return { file: f, when: st.mtime.toISOString(), size: st.size };
    }));
    return out.sort((a, b) => b.when.localeCompare(a.when));
  };
  const builds = (await listDir(BUILDS, ".html")).map((b) => ({ ...b, title: b.file.replace(/^\d{4}-\d\d-\d\dT[\d-]+-/, "").replace(/\.html$/, "").replace(/-/g, " ") }));
  const sessions = await Promise.all((await listDir(SESSIONS, ".json")).map(async (s) => {
    try { const j = JSON.parse(await fs.readFile(path.join(SESSIONS, s.file), "utf8")); return { ...s, id: s.file.replace(/\.json$/, ""), title: j.title || "Session", count: (j.messages || []).length }; }
    catch { return { ...s, id: s.file.replace(/\.json$/, ""), title: "Session", count: 0 }; }
  }));
  return NextResponse.json({ root: ROOT, builds, sessions });
}

// POST { action:"saveBuild", code, title }        → writes builds/<stamp>-<slug>.html
// POST { action:"saveSession", id, title, messages } → writes sessions/<id>.json + .md
export async function POST(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  await ensure();
  const body = await req.json().catch(() => ({}));
  if (body.action === "saveBuild") {
    if (typeof body.code !== "string" || !body.code.trim()) return NextResponse.json({ error: "code required" }, { status: 400 });
    const file = `${stamp()}-${slug(body.title)}.html`;
    await fs.writeFile(path.join(BUILDS, file), body.code, "utf8");
    return NextResponse.json({ ok: true, file });
  }
  if (body.action === "saveSession") {
    const id = safe(String(body.id || stamp()));
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const title = String(body.title || "Session").slice(0, 80);
    await fs.writeFile(path.join(SESSIONS, id + ".json"), JSON.stringify({ id, title, when: new Date().toISOString(), messages }, null, 2), "utf8");
    // human-readable transcript alongside
    const md = `# ${title}\n\n` + messages.map((m: { role: string; content: string }) => `**${m.role}:**\n\n${m.content}\n`).join("\n---\n\n");
    await fs.writeFile(path.join(SESSIONS, id + ".md"), md, "utf8");
    return NextResponse.json({ ok: true, id });
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
