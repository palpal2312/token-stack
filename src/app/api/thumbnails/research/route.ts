import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import { config } from "@/lib/config";
import { run } from "@/lib/runner";
import { hermesHome } from "@/lib/config";
import { saveThumbnailSession } from "@/lib/thumbnailLog";
import { checkLocalRequest } from "@/lib/localOnly";

const exec = promisify(execFile);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

// POST /api/thumbnails/research  { topic, faceless }
// 1) Grok 4.5 (Hermes, Grok OAuth) uses LIVE web/X search to see what wins RIGHT NOW
//    for the topic — your channel (if set) + top competitors — then maps
//    6 DISTINCT concepts onto your proven channel templates. Original, never copied.
// 2) Each concept -> a gpt-image-2 render (1920x1080). Faceless by default; opt-in to use
//    your real photo with a DIFFERENT expression + outfit per thumbnail.
const SCRIPT = path.join(homedir(), ".claude/skills/youtube-thumbnails/scripts/generate.py");
const STYLE_GUIDE = path.join(homedir(), ".claude/skills/youtube-thumbnails/reference/style-guide.md");
const FACE_PHOTO = path.join(homedir(), ".claude/skills/youtube-thumbnails/reference/face.jpg");
const REAL_THUMBS = path.join(homedir(), "Documents/Thumbnails");
const CHANNEL = config.youtubeChannel || "";
const WHO = config.userName && config.userName !== "You" ? config.userName : "the creator";

// ---- REAL competitor research: fetch top-ranking YouTube thumbnails for the topic ----
interface Competitor { videoId: string; title: string; channel: string; views: string }

async function fetchCompetitors(topic: string): Promise<Competitor[]> {
  try {
    const r = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(topic)}`,
      { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" }, signal: AbortSignal.timeout(15_000) });
    const html = await r.text();
    const m = html.match(/var ytInitialData = ({[\s\S]*?});<\/script>/);
    if (!m) return [];
    const out: Competitor[] = [];
    const walk = (o: unknown) => {
      if (out.length >= 8 || !o || typeof o !== "object") return;
      const rec = o as Record<string, unknown>;
      const v = rec.videoRenderer as Record<string, any> | undefined;
      if (v?.videoId) {
        const title = (v.title?.runs || []).map((x: any) => x.text).join("");
        const channel = (v.ownerText?.runs || []).map((x: any) => x.text).join("");
        if (!/julian goldie/i.test(channel)) out.push({ videoId: v.videoId, title: title.slice(0, 90), channel, views: v.viewCountText?.simpleText || "" });
      }
      for (const x of Object.values(rec)) walk(x);
    };
    walk(JSON.parse(m[1]));
    return out;
  } catch { return []; }
}

function openaiKey(): string | null {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  try {
    const env = readFileSync(path.join(homedir(), ".claude/skills/youtube-thumbnails/.env"), "utf8");
    const m = env.match(/^OPENAI_API_KEY=(.+)$/m);
    return m ? m[1].trim() : null;
  } catch { return null; }
}

// Vision pass: LOOK at the actual competitor thumbnails and distill why they win.
async function analyzeCompetitors(comps: Competitor[]): Promise<string> {
  const key = openaiKey();
  if (!key || !comps.length) return "";
  try {
    const content: any[] = [{
      type: "text",
      text: "These are the top-ranking YouTube thumbnails for a topic. As a thumbnail art director, analyse what makes them clean and clickable: element count, negative space, colour palette, typography treatment, composition, use of real photos/UI. Then give 6 concrete design lessons for BEATING them with a cleaner thumbnail. Be specific and terse. Plain text only.",
    }];
    for (const c of comps.slice(0, 6)) content.push({ type: "image_url", image_url: { url: `https://i.ytimg.com/vi/${c.videoId}/maxresdefault.jpg`, detail: "low" } });
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o", max_tokens: 700, messages: [{ role: "user", content }] }),
      signal: AbortSignal.timeout(60_000),
    });
    const j = await r.json();
    return String(j?.choices?.[0]?.message?.content || "").slice(0, 1600);
  } catch { return ""; }
}

// Two of your REAL winning channel thumbnails as style references per render,
// rotated by concept index so the six renders don't all anchor on the same pair.
function styleRefs(i: number): string[] {
  try {
    const files = readdirSync(REAL_THUMBS).filter((f) => /-HD.*\.jpe?g$/i.test(f));
    const uniq = [...new Map(files.map((f) => [f.slice(0, 11), f])).values()].sort();
    if (!uniq.length) return [];
    const a = uniq[i % uniq.length], b = uniq[(i + 7) % uniq.length];
    return [...new Set([a, b])].map((f) => path.join(REAL_THUMBS, f));
  } catch { return []; }
}

const SAFE_MARGINS = " Compose as a 16:9 YouTube thumbnail with clear breathing room inside every edge: keep the title and key elements in a safe central zone with a GENEROUS top margin. Nothing may touch or run off any edge.";

// Per-thumbnail variation so his face never looks the same twice (face mode only).
const EXPRESSIONS = ["shocked, wide eyes, jaw dropped", "big excited grin, eyebrows raised", "confident smirk, one eyebrow up", "amazed, both hands raised", "intense serious stare, leaning in", "delighted laugh, pointing"];
const OUTFITS = ["red blazer over a white tee", "black hoodie", "navy suit jacket, no tie", "grey crewneck sweatshirt", "white shirt, sleeves rolled up", "dark green bomber jacket"];

interface Concept { headline: string; template: string; subject: string; background: string; layout: string; accents: string; why: string }

function styleGuide(): string {
  try { return readFileSync(STYLE_GUIDE, "utf8").slice(0, 3800); } catch { return "Big bold 2-4 word two-tone outlined UPPERCASE headline, one clear hero subject, high contrast, bright accents (arrows, FREE badge, red/green), clean and premium."; }
}

function researchPrompt(topic: string, faceless: boolean, comps: Competitor[], analysis: string): string {
  const compBlock = comps.length
    ? [
        "STEP 1 — THE REAL COMPETITION (actual top-ranking YouTube results for this topic, fetched just now):",
        ...comps.slice(0, 8).map((c) => `- "${c.title}" — ${c.channel} (${c.views})`),
        analysis ? `\nAn art director LOOKED at these exact thumbnails and reports:\n${analysis}` : "",
        "\nYou will BEAT these — cleaner, clearer, more clickable. Never copy them. You may also live-search X/web for extra context.",
      ].join("\n")
    : "STEP 1 — RESEARCH (use your live web + X search now):\nSearch for what is WINNING right now for this exact topic on YouTube: your own recent videos AND the top competing AI/SEO/tech channels. Note what the strongest competitor thumbnails do — you will BEAT them, not copy them.";
  return [
    `You are the YouTube thumbnail STRATEGIST for ${WHO} — an AI / AI-agents / SEO / make-money-with-AI YouTube channel.`,
    CHANNEL ? `YOUR CHANNEL: ${CHANNEL}` : "No channel set — research this topic broadly on YouTube.",
    `TOPIC FOR THE NEW VIDEO: ${topic}`,
    "",
    compBlock,
    "",
    "STEP 2 — YOUR PROVEN CHANNEL STYLE (every concept must look like it belongs on your channel):",
    styleGuide(),
    "",
    "STEP 3 — DESIGN 6 thumbnails for this topic. Rules:",
    "- Each concept uses a DIFFERENT one of your proven templates above, adapted to the topic — so all 6 look on-brand yet clearly distinct from each other.",
    faceless
      ? "- FACELESS: no people, no human faces at all. Lean on logo-pill, 3D mascot, VS/DESTROYED, laptop/screen reveal, neon ranking list, sticker-bar and glowing-statue templates."
      : "- You appear as the reaction subject in the concepts where a face fits; the other concepts stay product/logo focused. Keep the right third clear for your face when used.",
    "- ORIGINAL: synthesise the winning patterns. Never trace, copy or recreate any specific competitor's actual thumbnail.",
    "- ACCURACY: only use a \"FREE\" badge or a price/$ accent if the TOPIC is genuinely about something free or a specific price. If it is not free, do NOT put FREE (or any price) in any concept — no exceptions.",
    "- Headlines: 2-4 UPPERCASE words, one calm setup word + one shock word, using his high-CTR vocabulary where it fits the topic.",
    "- CLEAN: the winners above are clean because they are SPARSE. HARD BUDGET per concept: headline + ONE hero element + at most ONE small accent. Nothing else. 40%+ of the frame stays empty. Solid or simple-gradient background (pure white, near-black, one flat colour) — never busy scenes. 2-3 colours total.",
    "",
    "Return ONLY a raw JSON array of exactly 6 objects, no prose, no markdown fences:",
    "[{",
    '  "headline": "2-4 UPPERCASE words, punchy shock hook",',
    '  "template": "which of his 8 templates this uses",',
    '  "subject": "the single hero subject / main visual",',
    '  "background": "colour + treatment",',
    '  "layout": "composition — where the headline and subject sit",',
    '  "accents": "badges / arrows / accent colours",',
    '  "why": "one short line: why this wins for the topic vs competitors"',
    "}]",
  ].join("\n");
}

function conceptToPrompt(c: Concept, faceless: boolean, i: number, nStyleRefs: number): string {
  const refIntro = nStyleRefs
    ? `The first ${nStyleRefs} reference image(s) are REAL thumbnails from this exact channel. Match their graphic design style PRECISELY — the same flat, clean, professionally-designed Photoshop finish, the same typography treatment, the same colour discipline. Do NOT copy their layout, words or subject: design something NEW in that style. `
    : ``;
  const base =
    refIntro +
    `Professional flat graphic-design YouTube thumbnail, 16:9, hand-made by a top thumbnail designer — NOT an AI illustration. ` +
    `Template: ${c.template}. ` +
    `Giant UPPERCASE headline reading "${c.headline}" in an ultra-heavy condensed sans-serif (Anton / Archivo Black style), tight letter-spacing, solid or smooth-gradient fill, with only a soft drop shadow — absolutely NO outline, NO stroke, NO border around the letters. ` +
    `Hero subject: ${c.subject}. Background: ${c.background} — kept SIMPLE and mostly flat. Layout: ${c.layout}. Accents: ${c.accents}. ` +
    `Design rules: SPARSE — the headline, ONE hero element and at most ONE small accent; nothing else in the frame. 40%+ empty negative space. 2-3 colour palette maximum, crisp flat shapes with clean edges, subtle drop shadows only, product logos rendered exactly. ` +
    `Strictly avoid: outlines or strokes around headline letters, lens flares, glow everywhere, hyperreal 3D gloss, bevelled 3D text, busy cluttered backgrounds, over-saturation, extra badges/cursors/underlines beyond the single accent. ` +
    `ORIGINAL composition — do not recreate any existing thumbnail.`;
  const face = faceless
    ? ` FACELESS design: absolutely NO people, NO human faces, NO person anywhere in the image — typography, logos, product UI and iconography only.`
    : ` The FINAL reference image is the channel host: feature him as the reaction subject on the right third, facing camera, cleanly cut out against the background. His expression: ${EXPRESSIONS[i % EXPRESSIONS.length]}. He is wearing ${OUTFITS[i % OUTFITS.length]}. Keep his face clearly recognisable but with THIS expression and outfit only.`;
  return base + face + SAFE_MARGINS;
}

function parseConcepts(raw: string): Concept[] {
  const s = raw.replace(/```json/gi, "").replace(/```/g, "");
  const a = s.indexOf("["), b = s.lastIndexOf("]");
  if (a === -1 || b === -1 || b < a) return [];
  try {
    const arr = JSON.parse(s.slice(a, b + 1));
    if (!Array.isArray(arr)) return [];
    return arr.filter((x) => x && typeof x.headline === "string").slice(0, 6).map((x) => ({
      headline: String(x.headline || "").slice(0, 60),
      template: String(x.template || "").slice(0, 120),
      subject: String(x.subject || "").slice(0, 200),
      background: String(x.background || "").slice(0, 120),
      layout: String(x.layout || "").slice(0, 200),
      accents: String(x.accents || "").slice(0, 160),
      why: String(x.why || "").slice(0, 160),
    }));
  } catch { return []; }
}

export async function POST(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const body = await req.json().catch(() => ({}));
  const topic = String(body.topic || "").trim();
  const faceless = body.faceless !== false; // default: faceless
  if (!topic) return NextResponse.json({ error: "Pick a topic first." }, { status: 400 });
  if (topic.length > 400) return NextResponse.json({ error: "Topic too long." }, { status: 413 });

  // 0) REAL competitor research: top YouTube results for the topic + vision analysis of their thumbnails
  const comps = await fetchCompetitors(topic);
  const analysis = await analyzeCompetitors(comps);

  // 1) Research -> 6 concepts (Grok 4.5 on Grok OAuth, grounded in the real competition)
  let concepts: Concept[] = [];
  let dbg = "";
  try {
    const res = await run("hermes", ["--profile", "grok-4-5", "-z", researchPrompt(topic, faceless, comps, analysis), "--yolo", "--accept-hooks"], {
      cwd: path.join(hermesHome(), "profiles", "grok-4-5", "workspace"),
      timeoutMs: 300_000,
    });
    concepts = parseConcepts(res.stdout || "");
    if (!concepts.length) dbg = `[code ${res.code}] ${(res.stderr || res.stdout || "empty").slice(-260)}`;
  } catch (e) { dbg = String((e as Error)?.message || e).slice(-260); }
  if (concepts.length < 3) {
    return NextResponse.json({ error: `Couldn't research concepts. ${dbg}` }, { status: 502 });
  }

  // 2) Render each concept with gpt-image-2, in parallel
  const useFace = !faceless && existsSync(FACE_PHOTO);
  const env = { ...process.env, PATH: `${process.env.PATH || ""}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin` };
  const work = path.join(tmpdir(), `thumbresearch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  const outRoot = path.join(work, "out");
  await mkdir(outRoot, { recursive: true });
  const t0 = Date.now();

  const jobs = concepts.map(async (c, i): Promise<Buffer> => {
    const sub = path.join(outRoot, `v${i}`);
    await mkdir(sub, { recursive: true });
    const refs = styleRefs(i);
    const cliArgs = [SCRIPT, "--prompt", conceptToPrompt(c, faceless, i, refs.length), "--out", sub, "--slug", "thumb", "--fit", "cover", "--out-size", "1920x1080", "--format", "png"];
    refs.forEach((r) => cliArgs.push("--ref", r));
    if (useFace) cliArgs.push("--ref", FACE_PHOTO); // host photo LAST — prompt refers to "final reference image"
    await exec("python3", cliArgs, { timeout: 285_000, maxBuffer: 32 * 1024 * 1024, env });
    const f = (await readdir(sub)).find((x) => /\.(jpe?g|png)$/i.test(x));
    if (!f) throw new Error("no image produced");
    return readFile(path.join(sub, f));
  });

  const settled = await Promise.allSettled(jobs);
  const durationMs = Date.now() - t0;
  const outputs: { name: string; buf: Buffer }[] = [];
  const items: { image: string; concept: Concept }[] = [];
  let firstErr = "";
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") {
      outputs.push({ name: `thumb-${i + 1}.png`, buf: s.value });
      items.push({ image: `data:image/png;base64,${s.value.toString("base64")}`, concept: concepts[i] });
    } else if (!firstErr) { const e = s.reason as { stderr?: string; message?: string }; firstErr = e?.stderr || e?.message || "generation failed"; }
  });

  if (!outputs.length) {
    await rm(work, { recursive: true, force: true }).catch(() => {});
    const raw = firstErr || "No images were produced.";
    let msg = raw.slice(-400);
    if (/insufficient_quota|exceeded your current quota/i.test(raw)) msg = "Your OpenAI API account is out of credits (prepaid, separate from ChatGPT Plus) — add credits at platform.openai.com → Billing.";
    else if (/invalid_api_key|401/i.test(raw)) msg = "OpenAI key rejected — check OPENAI_API_KEY in ~/.claude/skills/youtube-thumbnails/.env.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const session = await saveThumbnailSession({ instructions: `Research thumbnails · ${faceless ? "faceless" : "with your face"} · topic: ${topic}`, inputs: [], outputs, durationMs });
  await rm(work, { recursive: true, force: true }).catch(() => {});
  return NextResponse.json({ ok: true, items, savedTo: session ? `Thumbnails/${session.folder}` : null });
}
