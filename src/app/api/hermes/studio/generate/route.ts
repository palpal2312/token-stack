import { NextResponse } from "next/server";
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { studioDirs, minimaxToken, slugify, MINIMAX_BASE, PREVIEW_BUCKET } from "@/lib/hermesStudio";
import { elevenTtsToFile } from "@/lib/elevenlabs";
import { hermesHome } from "@/lib/config";
import { checkLocalRequest } from "@/lib/localOnly";

const pexecFile = promisify(execFile);
// ALL Grok gen (image/video/voice) runs through Hermes' own xAI credentials (Grok OAuth),
// NOT openclaw. HERMES_HOME points at a profile holding the xai-oauth token; the hermes-agent
// venv python runs scripts/hermes-xai-media.py, which refreshes + calls xAI's endpoints.
const HERMES_VENV_PY = path.join(hermesHome(), "hermes-agent", ".venv", "bin", "python");
const XAI_MEDIA_SCRIPT = path.join(process.cwd(), "scripts", "hermes-xai-media.py");
const XAI_HOME = path.join(hermesHome(), "profiles", "julian"); // holds the xai-oauth token

// Run the Hermes xAI media helper for one kind; returns whether the output file was written.
async function xaiMedia(kind: "image" | "video" | "voice", prompt: string, outPath: string, voice?: string, timeoutMs = 130_000): Promise<{ ok: boolean; detail: string }> {
  const args = [XAI_MEDIA_SCRIPT, kind, prompt, outPath];
  if (kind === "voice" && voice) args.push(voice);
  try {
    const { stdout } = await pexecFile(HERMES_VENV_PY, args, { env: { ...process.env, HERMES_HOME: XAI_HOME }, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 });
    return { ok: existsSync(outPath), detail: stdout.slice(-400) };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    return { ok: existsSync(outPath), detail: (err.stdout || err.stderr || err.message || "").slice(-400) };
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/hermes/studio/generate
//   { kind: "image"|"voice"|"video", prompt, voiceId?, provider?: "minimax"|"grok" }
//
// One Studio, two engines:
//   • minimax → MiniMax APIs (image-01, Hailuo, speech-02). Video is async → returns { taskId } to poll.
//   • grok    → Hermes' own xAI tools via Grok OAuth (scripts/hermes-xai-media.py). No openclaw.
// Both save into the SAME Hermes typed dirs (images / videos / audio_cache) so the
// gallery + Workspace buckets show every generation regardless of engine.
const XAI_VOICES = new Set(["eve", "ara", "rex", "sal", "leo", "una"]);

export async function POST(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Body must be JSON." }, { status: 400 }); }
  const { kind, prompt, voiceId, provider } = body as { kind: string; prompt: string; voiceId: string; provider: string };
  if (typeof prompt !== "string" || !prompt.trim()) return NextResponse.json({ error: "missing prompt" }, { status: 400 });
  // image/b-roll prompts stay short; voice narration can be long (a 6-min script ≈ 6k chars).
  if (prompt.length > (kind === "voice" ? 12000 : 2000)) return NextResponse.json({ error: "prompt too long" }, { status: 413 });

  // ───────────────────────── ELEVENLABS (voice only) ─────────────────────────
  if (provider === "elevenlabs" && kind === "voice") {
    try {
      const { name, url } = await elevenTtsToFile(prompt, typeof voiceId === "string" ? voiceId : undefined);
      return NextResponse.json({ ok: true, kind, provider: "elevenlabs", name, prompt, url });
    } catch (e) {
      return NextResponse.json({ error: `ElevenLabs voice failed: ${String(e)}` }, { status: 502 });
    }
  }

  const eng = provider === "grok" ? "grok" : "minimax";
  const dirs = studioDirs();
  const ts = Date.now();
  const slug = slugify(prompt);

  // ───────────────────────── GROK (via Hermes xAI OAuth) ─────────────────────────
  if (eng === "grok") {
    try {
      if (kind === "image") {
        await mkdir(dirs.image, { recursive: true });
        const outPath = path.join(dirs.image, `${ts}-grok-${slug}.jpg`);
        const res = await xaiMedia("image", prompt, outPath, undefined, 130_000);
        if (!res.ok) return NextResponse.json({ error: "Grok image failed", detail: res.detail }, { status: 502 });
        const name = path.basename(outPath);
        return NextResponse.json({ ok: true, kind, provider: eng, name, prompt, url: `/api/hermes/preview/${PREVIEW_BUCKET.image}/${encodeURIComponent(name)}` });
      }
      if (kind === "video") {
        await mkdir(dirs.video, { recursive: true });
        const outPath = path.join(dirs.video, `${ts}-grok-${slug}.mp4`);
        const res = await xaiMedia("video", prompt, outPath, undefined, 300_000); // xAI video is async (submit + poll)
        if (!res.ok) return NextResponse.json({ error: "Grok video failed", detail: res.detail }, { status: 502 });
        const name = path.basename(outPath);
        return NextResponse.json({ ok: true, kind, provider: eng, status: "done", name, prompt, url: `/api/hermes/preview/${PREVIEW_BUCKET.video}/${encodeURIComponent(name)}` });
      }
      if (kind === "voice") {
        const v = typeof voiceId === "string" && XAI_VOICES.has(voiceId) ? voiceId : "eve";
        await mkdir(dirs.voice, { recursive: true });
        const outPath = path.join(dirs.voice, `${ts}-grok-${v}-${slug}.mp3`);
        const res = await xaiMedia("voice", prompt, outPath, v, 90_000);
        if (!res.ok) return NextResponse.json({ error: "Grok voice failed", detail: res.detail }, { status: 502 });
        const name = path.basename(outPath);
        return NextResponse.json({ ok: true, kind, provider: eng, name, prompt, url: `/api/hermes/preview/${PREVIEW_BUCKET.voice}/${encodeURIComponent(name)}` });
      }
      return NextResponse.json({ error: "bad kind" }, { status: 400 });
    } catch (e) {
      return NextResponse.json({ error: `Grok generation failed: ${String(e)}` }, { status: 500 });
    }
  }

  // ───────────────────────── MINIMAX (via API) ─────────────────────────
  const tok = minimaxToken();
  if (!tok) return NextResponse.json({ error: "MiniMax not connected. Run `hermes auth add minimax-oauth` in a terminal." }, { status: 400 });
  const H = { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" };

  try {
    if (kind === "image") {
      const r = await fetch(`${MINIMAX_BASE}/image_generation`, { method: "POST", headers: H, body: JSON.stringify({ model: "image-01", prompt, aspect_ratio: "16:9", response_format: "url", n: 1 }) });
      const j = await r.json();
      const src = j?.data?.image_urls?.[0];
      if (!src) return NextResponse.json({ error: `MiniMax: ${j?.base_resp?.status_msg || "no image returned"} — switch to Grok above, or top up MiniMax.`, detail: j?.base_resp ?? j }, { status: 502 });
      const buf = Buffer.from(await (await fetch(src)).arrayBuffer());
      await mkdir(dirs.image, { recursive: true });
      const name = `${ts}-${slug}.png`;
      await writeFile(path.join(dirs.image, name), buf);
      return NextResponse.json({ ok: true, kind, provider: eng, name, prompt, url: `/api/hermes/preview/${PREVIEW_BUCKET.image}/${encodeURIComponent(name)}` });
    }
    if (kind === "voice") {
      const vid = typeof voiceId === "string" && /^[a-z0-9-]+$/i.test(voiceId) ? voiceId : "male-qn-qingse";
      const r = await fetch(`${MINIMAX_BASE}/t2a_v2`, { method: "POST", headers: H, body: JSON.stringify({ model: "speech-02-hd", text: prompt, stream: false, voice_setting: { voice_id: vid, speed: 1, vol: 1, pitch: 0 }, audio_setting: { format: "mp3", sample_rate: 32000, bitrate: 128000 } }) });
      const j = await r.json();
      const hex = j?.data?.audio;
      if (!hex) return NextResponse.json({ error: "no audio returned", detail: j?.base_resp ?? j }, { status: 502 });
      await mkdir(dirs.voice, { recursive: true });
      const name = `${ts}-${slug}.mp3`;
      await writeFile(path.join(dirs.voice, name), Buffer.from(hex, "hex"));
      return NextResponse.json({ ok: true, kind, provider: eng, name, prompt, url: `/api/hermes/preview/${PREVIEW_BUCKET.voice}/${encodeURIComponent(name)}` });
    }
    if (kind === "video") {
      const r = await fetch(`${MINIMAX_BASE}/video_generation`, { method: "POST", headers: H, body: JSON.stringify({ model: "MiniMax-Hailuo-2.3", prompt, duration: 6, resolution: "768P" }) });
      const j = await r.json();
      const taskId = j?.task_id;
      if (!taskId) return NextResponse.json({ error: "no task_id returned", detail: j?.base_resp ?? j }, { status: 502 });
      return NextResponse.json({ ok: true, kind, provider: eng, status: "processing", taskId: String(taskId), slug, prompt });
    }
    return NextResponse.json({ error: "bad kind" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
