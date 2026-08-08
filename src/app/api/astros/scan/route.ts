import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { run } from "@/lib/runner";
import { mkdir, writeFile, readFile, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// HERMES ASTROS — a 24/7 YouTube watcher, sibling of The Radar (which reads X).
// It scans the LATEST uploads from competitor channels in the user's niche + fresh
// keyword search results, then asks Hermes to synthesize: the topics breaking on
// YouTube right now, ready-to-use YouTube TITLES for each, the SEO keyword, content
// angles and a hook — with one-click handoffs to the Video agent, NotebookLM, or
// SEO publishing. Engine tiers for "your Google API": OAuth token (youtube.readonly,
// minted by ~/.agentic-os/astros-youtube-auth.py) → YT_API_KEY env → keyless
// fallback (channel RSS feeds + YouTube search-page scrape). The scan itself never
// needs a key to work.

const ASTROS_DIR = path.join(os.homedir(), ".agentic-os", "astros");
const HISTORY_DIR = path.join(ASTROS_DIR, "history");
const LATEST = path.join(ASTROS_DIR, "latest.json");
const STATUS = path.join(ASTROS_DIR, "status.json");
const CONFIG = path.join(ASTROS_DIR, "config.json");
const YT_TOKEN = path.join(ASTROS_DIR, "youtube-token.json");
const VAULT_DIR = config.vaultRoot ? path.join(config.vaultRoot, "YouTube Astros") : "";

export interface AstroTopic {
  topic: string; why_hot: string; heat: number; category: string;
  competitor: { channel: string; video_title: string; url: string; views: string; age: string };
  titles: string[]; seo_keyword: string; angles: string[]; hook: string; format: string;
}
interface AstrosConfig { channels: { id: string; title: string }[]; keywords: string[] }
interface RawVideo { videoId: string; title: string; channel: string; channelId: string; published: string; views: string; source: string }

const SEED_KEYWORDS = [
  "claude code", "ai agents", "ai automation", "cursor ai", "ai seo",
  "make money with ai", "n8n automation", "notebooklm", "vibe coding",
];

async function loadConfig(): Promise<AstrosConfig> {
  try {
    const c = JSON.parse(await readFile(CONFIG, "utf8"));
    return { channels: Array.isArray(c.channels) ? c.channels.slice(0, 30) : [], keywords: Array.isArray(c.keywords) && c.keywords.length ? c.keywords.slice(0, 15) : SEED_KEYWORDS };
  } catch { return { channels: [], keywords: SEED_KEYWORDS }; }
}
async function saveConfig(c: AstrosConfig) {
  try { await mkdir(ASTROS_DIR, { recursive: true }); await writeFile(CONFIG, JSON.stringify(c, null, 2), "utf8"); } catch { /* best effort */ }
}

// ---------- tier 1: the user's Google API (OAuth refresh-token minted once via astros-youtube-auth.py) ----------
async function oauthAccessToken(): Promise<string | null> {
  try {
    const t = JSON.parse(await readFile(YT_TOKEN, "utf8"));
    if (!t.refresh_token || !t.client_id || !t.client_secret) return null;
    const body = new URLSearchParams({ client_id: t.client_id, client_secret: t.client_secret, refresh_token: t.refresh_token, grant_type: "refresh_token" });
    const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body, signal: AbortSignal.timeout(15000) });
    const d = await r.json();
    return d.access_token || null;
  } catch { return null; }
}

function fmtViews(n: number | string): string {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M views`;
  if (v >= 1_000) return `${Math.round(v / 1_000)}K views`;
  return v ? `${v} views` : "";
}
function agoFrom(iso: string): string {
  const s = Math.floor((Date.now() - Date.parse(iso)) / 1000);
  if (isNaN(s) || s < 0) return "";
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// Data API search (works with either an OAuth bearer or an API key)
async function apiSearch(q: string, auth: { bearer?: string; key?: string }, max = 8): Promise<RawVideo[]> {
  const pub = new Date(Date.now() - 7 * 86400_000).toISOString();
  const u = new URL("https://www.googleapis.com/youtube/v3/search");
  u.searchParams.set("part", "snippet"); u.searchParams.set("q", q); u.searchParams.set("type", "video");
  u.searchParams.set("order", "date"); u.searchParams.set("maxResults", String(max)); u.searchParams.set("publishedAfter", pub);
  if (auth.key) u.searchParams.set("key", auth.key);
  const r = await fetch(u, { headers: auth.bearer ? { Authorization: `Bearer ${auth.bearer}` } : {}, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`yt api ${r.status}`);
  const d = await r.json();
  return (d.items || []).map((it: { id: { videoId: string }; snippet: { title: string; channelTitle: string; channelId: string; publishedAt: string } }) => ({
    videoId: it.id.videoId, title: it.snippet.title, channel: it.snippet.channelTitle,
    channelId: it.snippet.channelId, published: it.snippet.publishedAt, views: "", source: `api:${q}`,
  }));
}

// ---------- tier 3: keyless — channel RSS + search-page scrape ----------
async function rssChannel(ch: { id: string; title: string }): Promise<RawVideo[]> {
  try {
    const r = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${ch.id}`, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return [];
    const xml = await r.text();
    const out: RawVideo[] = [];
    const entries = xml.split("<entry>").slice(1, 8);
    for (const e of entries) {
      const vid = e.match(/<yt:videoId>([^<]+)</)?.[1] || "";
      const title = e.match(/<title>([^<]*)</)?.[1] || "";
      const published = e.match(/<published>([^<]+)</)?.[1] || "";
      const views = e.match(/views="(\d+)"/)?.[1] || "";
      if (!vid || !title) continue;
      // only fresh uploads (last 7 days)
      if (published && Date.now() - Date.parse(published) > 7 * 86400_000) continue;
      out.push({ videoId: vid, title: decodeXml(title), channel: ch.title, channelId: ch.id, published, views: fmtViews(views), source: `rss:${ch.title}` });
    }
    return out;
  } catch { return []; }
}
function decodeXml(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

// Scrape youtube.com search results (upload-date sorted, this week) via the embedded ytInitialData JSON.
async function scrapeSearch(q: string, max = 8): Promise<RawVideo[]> {
  try {
    // sp=CAISBAgCEAE%3D → sort by upload date + uploaded this week + video type
    const u = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=CAISBAgCEAE%253D&hl=en`;
    const r = await fetch(u, { headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36", "accept-language": "en" }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) return [];
    const html = await r.text();
    const m = html.match(/var ytInitialData = (\{[\s\S]*?\});<\/script>/);
    if (!m) return [];
    const data = JSON.parse(m[1]);
    const out: RawVideo[] = [];
    const walk = (node: unknown) => {
      if (!node || typeof node !== "object" || out.length >= max) return;
      const rec = node as Record<string, unknown>;
      const vr = rec.videoRenderer as Record<string, unknown> | undefined;
      if (vr && typeof vr.videoId === "string") {
        const title = ((vr.title as Record<string, unknown>)?.runs as { text: string }[] | undefined)?.[0]?.text || "";
        const channel = (((vr.ownerText as Record<string, unknown>)?.runs as { text: string; navigationEndpoint?: { browseEndpoint?: { browseId?: string } } }[] | undefined))?.[0];
        const views = (vr.viewCountText as { simpleText?: string })?.simpleText || "";
        const age = (vr.publishedTimeText as { simpleText?: string })?.simpleText || "";
        if (title) out.push({
          videoId: vr.videoId as string, title, channel: channel?.text || "", channelId: channel?.navigationEndpoint?.browseEndpoint?.browseId || "",
          published: age, views, source: `search:${q}`,
        });
        return;
      }
      for (const k of Object.keys(rec)) walk(rec[k]);
    };
    walk(data);
    return out.slice(0, max);
  } catch { return []; }
}

// ---------- gather: channels + keywords across whatever tier is available ----------
async function gather(cfg: AstrosConfig, phase: (p: string) => Promise<void>): Promise<{ videos: RawVideo[]; engine: string }> {
  const bearer = await oauthAccessToken();
  const key = process.env.YT_API_KEY || "";
  const engine = bearer ? "google-oauth" : key ? "api-key" : "rss+scrape";
  await phase(`Scanning YouTube (${engine}) — competitor channels…`);
  const channelVids = (await Promise.all(cfg.channels.map((c) => rssChannel(c)))).flat();
  await phase(`Scanning YouTube (${engine}) — keyword watchlist…`);
  const kwResults: RawVideo[] = [];
  for (const q of cfg.keywords) {
    let vids: RawVideo[] = [];
    if (bearer || key) { try { vids = await apiSearch(q, { bearer: bearer || undefined, key: bearer ? undefined : key }); } catch { vids = await scrapeSearch(q); } }
    else vids = await scrapeSearch(q);
    kwResults.push(...vids);
  }
  // dedupe by videoId, cap for the prompt — runner.ts silently DROPS any arg over
  // 32K chars, so the feed must stay comfortably under that (90 lines ≈ 18K chars).
  const seen = new Set<string>();
  const videos = [...channelVids, ...kwResults]
    .filter((v) => { if (seen.has(v.videoId)) return false; seen.add(v.videoId); return true; })
    .slice(0, 90)
    .map((v) => ({ ...v, title: v.title.slice(0, 90) }));
  return { videos, engine };
}

// ---------- synthesis: Hermes turns raw video signals into topics + titles + angles ----------
function synthesisPrompt(videos: RawVideo[], cfg: AstrosConfig, now: Date): string {
  const today = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const who = config.userName && config.userName !== "You" ? config.userName : "the user";
  const feed = videos.map((v) => `- [${v.source}] "${v.title}" — ${v.channel}${v.views ? ` · ${v.views}` : ""}${v.published ? ` · ${/ago|day|hour|week/.test(v.published) ? v.published : agoFrom(v.published)}` : ""} · https://www.youtube.com/watch?v=${v.videoId}${v.channelId ? ` · channelId:${v.channelId}` : ""}`).join("\n");
  return [
    `You are HERMES ASTROS — ${who}'s 24/7 YouTube competitor watcher and title strategist.`,
    `${who} runs an AI/AI-agents YouTube channel (Claude Code, Hermes, Agent OS, AI automation, AI SEO, make-money-with-AI). Audience: creators, agency owners, founders building with AI.`,
    `TODAY IS ${today}.`,
    "",
    "Below are the FRESHEST videos scraped from competitor channels + keyword searches in this niche (last 7 days):",
    feed || "(the scan returned nothing — say so via an empty topics array)",
    "",
    "YOUR JOB — return ONLY a JSON object with two keys:",
    "1. \"topics\": array of the 6 hottest CONTENT OPPORTUNITIES for this channel right now, ranked. For each:",
    "{",
    '  "topic": "<= 9 words naming the opportunity, specific",',
    '  "why_hot": "1-2 sentences: what competitors did, the view velocity, why it works right now",',
    '  "heat": integer 1-100,',
    '  "category": one of "Models" | "Agents" | "Tools" | "SEO" | "Money" | "Drama",',
    '  "competitor": {"channel": "name", "video_title": "their exact video title", "url": "the real watch url from the feed above", "views": "e.g. 120K views (only if shown above)", "age": "e.g. 2 days ago"},',
    '  "titles": [5 ready YouTube titles for THIS channel, each under 55 chars, high-CTR, curiosity + outcome, no clickbait lies — pattern-match what is working in the feed],',
    '  "seo_keyword": "the primary search keyword to target",',
    '  "angles": [3 distinct content angles, 1 sentence each — e.g. contrarian take, build-along, comparison],',
    '  "hook": "a punchy 1-line opening for the video",',
    '  "format": one of "Video" | "Short" | "Livestream" | "Guide"',
    "}",
    "2. \"new_channels\": array of up to 4 channels from the feed that are clearly COMPETITORS in this niche and worth tracking permanently: [{\"id\": \"the channelId (starts with UC)\", \"title\": \"channel name\", \"why\": \"1 short reason\"}]. Only channels whose channelId appears in the feed. Exclude channels already tracked: " + (cfg.channels.map((c) => c.title).join(", ") || "(none yet)"),
    "",
    "RULES: every competitor.url must be a REAL url from the feed. Use REAL view counts/ages only from the feed — never invent numbers. Rank by what this audience would click TODAY.",
    "Output ONLY the raw JSON object — no commentary, no markdown fences.",
  ].join("\n");
}

function extractObj(raw: string): { topics?: unknown[]; new_channels?: unknown[] } {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{"); const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return {};
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return {}; }
}

function normalize(arr: unknown[]): AstroTopic[] {
  return (arr || [])
    .filter((x): x is Record<string, unknown> => !!x && typeof (x as Record<string, unknown>).topic === "string")
    .slice(0, 8)
    .map((x) => {
      const comp = (x.competitor || {}) as Record<string, unknown>;
      const url = String(comp.url || "");
      return {
        topic: String(x.topic || "").slice(0, 140),
        why_hot: String(x.why_hot || "").slice(0, 500),
        heat: Math.max(1, Math.min(100, Math.round(Number(x.heat) || 50))),
        category: String(x.category || "Agents"),
        competitor: {
          channel: String(comp.channel || "").slice(0, 80),
          video_title: String(comp.video_title || "").slice(0, 160),
          url: /^https?:\/\/(www\.)?youtube\.com\/watch\?v=[\w-]{6,}/.test(url) ? url.slice(0, 200) : "",
          views: String(comp.views || "").slice(0, 40),
          age: String(comp.age || "").slice(0, 40),
        },
        titles: Array.isArray(x.titles) ? x.titles.slice(0, 5).map((t) => String(t).slice(0, 90)) : [],
        seo_keyword: String(x.seo_keyword || "").slice(0, 80),
        angles: Array.isArray(x.angles) ? x.angles.slice(0, 3).map((a) => String(a).slice(0, 240)) : [],
        hook: String(x.hook || "").slice(0, 240),
        format: String(x.format || "Video"),
      };
    });
}

function pad(n: number) { return String(n).padStart(2, "0"); }
function obsidianBlock(topics: AstroTopic[], when: Date): string {
  const time = `${pad(when.getHours())}:${pad(when.getMinutes())}`;
  const lines = [`\n## Sweep · ${time}\n`];
  topics.forEach((t, i) => {
    lines.push(`### ${i + 1}. ${t.topic}`);
    lines.push(`*heat ${t.heat} · ${t.category} · target: ${t.seo_keyword}*`);
    lines.push(t.why_hot);
    if (t.competitor.channel) lines.push(`- **Competitor:** ${t.competitor.channel} — "${t.competitor.video_title}" (${[t.competitor.views, t.competitor.age].filter(Boolean).join(" · ")}) ${t.competitor.url}`);
    t.titles.forEach((ti) => lines.push(`- **Title:** ${ti}`));
    t.angles.forEach((a) => lines.push(`- **Angle:** ${a}`));
    if (t.hook) lines.push(`- **Hook:** "${t.hook}"`);
    lines.push("");
  });
  return lines.join("\n");
}

async function persist(topics: AstroTopic[], engine: string, videosScanned: number, scannedAt: string) {
  const when = new Date(scannedAt);
  const day = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
  const payload = { ok: true, scannedAt, day, engine, videosScanned, topics };
  try {
    await mkdir(HISTORY_DIR, { recursive: true });
    await writeFile(LATEST, JSON.stringify(payload, null, 2), "utf8");
    await writeFile(path.join(HISTORY_DIR, `${day}.json`), JSON.stringify(payload, null, 2), "utf8");
  } catch { /* best effort */ }
  if (VAULT_DIR) try {
    await mkdir(VAULT_DIR, { recursive: true });
    const file = path.join(VAULT_DIR, `${day}.md`);
    const block = obsidianBlock(topics, when);
    if (existsSync(file)) await appendFile(file, block, "utf8");
    else {
      const niceDay = when.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
      await writeFile(file, `# YouTube Astros — ${niceDay}\n\n> Auto-logged by Hermes Astros (Agent OS) — what's breaking on YouTube in your niche, each sweep appended below.\n` + block, "utf8");
    }
  } catch { /* vault logging is best-effort */ }
  return payload;
}

interface SweepStatus { running: boolean; startedAt?: string; endedAt?: string; phase?: string; error?: string; scannedAt?: string; engine?: string }
async function readStatus(): Promise<SweepStatus> {
  try { return JSON.parse(await readFile(STATUS, "utf8")); } catch { return { running: false }; }
}
async function writeStatus(s: SweepStatus) {
  try { await mkdir(ASTROS_DIR, { recursive: true }); await writeFile(STATUS, JSON.stringify(s), "utf8"); } catch { /* best effort */ }
}

async function runSweep(): Promise<void> {
  const startedAt = new Date().toISOString();
  const phase = (p: string) => writeStatus({ running: true, startedAt, phase: p });
  await phase("Reading the night sky…");
  try {
    const cfg = await loadConfig();
    const { videos, engine } = await gather(cfg, phase);
    if (!videos.length) {
      await writeStatus({ running: false, startedAt, endedAt: new Date().toISOString(), error: "The scan found no fresh videos — YouTube may be rate-limiting. Try again shortly." });
      return;
    }
    await phase(`Hermes is reading ${videos.length} fresh videos…`);
    // Pin to Grok/xAI — same reason as the radar: the profile's active_provider may be
    // nous/openrouter, whose models lack a tool-use endpoint → 404 → empty synthesis.
    const RADAR_PROVIDER = process.env.RADAR_PROVIDER || "xai-oauth";
    const RADAR_MODEL = process.env.RADAR_MODEL || "grok-4";
    const res = await run("hermes", ["-z", synthesisPrompt(videos, cfg, new Date()), "--provider", RADAR_PROVIDER, "--model", RADAR_MODEL], { cwd: os.homedir(), timeoutMs: 420_000 });
    const obj = extractObj(res.stdout || "");
    const topics = normalize((obj.topics as unknown[]) || []);
    if (!topics.length) {
      const se = (res.stderr || "").trim();
      await writeStatus({ running: false, startedAt, endedAt: new Date().toISOString(), error: se.slice(-200) || "Hermes returned no topics — try again in a moment." });
      return;
    }
    // auto-track newly discovered competitor channels (capped)
    try {
      const fresh = ((obj.new_channels as { id?: string; title?: string }[]) || [])
        .filter((c) => typeof c.id === "string" && /^UC[\w-]{16,}$/.test(c.id) && c.title)
        .map((c) => ({ id: String(c.id), title: String(c.title).slice(0, 80) }));
      if (fresh.length) {
        const have = new Set(cfg.channels.map((c) => c.id));
        const merged = [...cfg.channels, ...fresh.filter((c) => !have.has(c.id))].slice(0, 30);
        if (merged.length !== cfg.channels.length) await saveConfig({ ...cfg, channels: merged });
      }
    } catch { /* discovery is best-effort */ }
    const payload = await persist(topics, engine, videos.length, new Date().toISOString());
    await writeStatus({ running: false, startedAt, endedAt: new Date().toISOString(), scannedAt: payload.scannedAt, engine });
  } catch (e) {
    await writeStatus({ running: false, startedAt, endedAt: new Date().toISOString(), error: String((e as Error)?.message || e) });
  }
}

// POST — kick a sweep, return immediately (fire-and-forget; survives page navigation).
export async function POST(req: Request) {
  const guard = checkLocalRequest(req, { requireJson: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const st = await readStatus();
  if (st.running && st.startedAt && Date.now() - new Date(st.startedAt).getTime() < 500_000) {
    return Response.json({ ok: true, status: "running", startedAt: st.startedAt });
  }
  const startedAt = new Date().toISOString();
  await writeStatus({ running: true, startedAt, phase: "Waking Hermes Astros…" });
  void runSweep();
  return Response.json({ ok: true, status: "started", startedAt });
}

// GET — poll sweep status (self-heals a stale running flag after a restart).
export async function GET() {
  const st = await readStatus();
  if (st.running && st.startedAt && Date.now() - new Date(st.startedAt).getTime() > 500_000) {
    const healed = { ...st, running: false, error: st.error || "The last sweep was interrupted — try again." };
    await writeStatus(healed);
    return Response.json(healed);
  }
  return Response.json(st);
}
