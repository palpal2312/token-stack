import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Astros watchlist: tracked competitor channels + keyword watchlist, editable from the UI.
// Also reports which YouTube engine is active (google-oauth / api-key / rss+scrape).

const ASTROS_DIR = path.join(os.homedir(), ".agentic-os", "astros");
const CONFIG = path.join(ASTROS_DIR, "config.json");
const YT_TOKEN = path.join(ASTROS_DIR, "youtube-token.json");

const SEED_KEYWORDS = [
  "claude code", "ai agents", "ai automation", "cursor ai", "ai seo",
  "make money with ai", "n8n automation", "notebooklm", "vibe coding",
];

async function load() {
  try {
    const c = JSON.parse(await readFile(CONFIG, "utf8"));
    return {
      channels: Array.isArray(c.channels) ? c.channels.slice(0, 30) : [],
      keywords: Array.isArray(c.keywords) && c.keywords.length ? c.keywords.slice(0, 15) : SEED_KEYWORDS,
    };
  } catch { return { channels: [], keywords: SEED_KEYWORDS }; }
}

async function engine(): Promise<string> {
  try { await readFile(YT_TOKEN, "utf8"); return "google-oauth"; } catch { /* no token */ }
  return process.env.YT_API_KEY ? "api-key" : "rss+scrape";
}

export async function GET() {
  const cfg = await load();
  return Response.json({ ok: true, ...cfg, engine: await engine() });
}

export async function POST(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const body = await req.json().catch(() => ({}));
  const cur = await load();
  const channels = Array.isArray(body.channels)
    ? body.channels.filter((c: { id?: string; title?: string }) => typeof c?.id === "string" && /^UC[\w-]{16,}$/.test(c.id) && c.title).map((c: { id: string; title: string }) => ({ id: c.id, title: String(c.title).slice(0, 80) })).slice(0, 30)
    : cur.channels;
  const keywords = Array.isArray(body.keywords)
    ? body.keywords.map((k: unknown) => String(k).trim().slice(0, 60)).filter(Boolean).slice(0, 15)
    : cur.keywords;
  try {
    await mkdir(ASTROS_DIR, { recursive: true });
    await writeFile(CONFIG, JSON.stringify({ channels, keywords }, null, 2), "utf8");
    return Response.json({ ok: true, channels, keywords, engine: await engine() });
  } catch (e) {
    return Response.json({ ok: false, error: String((e as Error)?.message || e) }, { status: 500 });
  }
}
