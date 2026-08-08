import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { VIDEO_ROOT } from "@/lib/videoProjects";
import { checkLocalRequest } from "@/lib/localOnly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/video/hyperframes/keyframes
// Body: { slug: string, shot?: boolean, selector?: string, samples?: number }
//
// Runs `hyperframes keyframes` (v0.7.31+) to let the agent SEE its own motion:
//   • --json  → machine-readable timeline of every tween (GSAP/CSS/Anime),
//               its keyframes, timing, easing and motion path.
//   • --shot  → an onion-skin diagnostic PNG (the element ghosted across the
//               timeline) for one selector that has positional motion — the
//               "look at your motion and fix it" view.
// Fast + synchronous (a few seconds), so no job/polling needed.

const HYPERFRAMES_BIN = path.join(os.homedir(), "local", "node", "bin", "hyperframes");
const run = promisify(execFile);

type Tween = {
  id: string;
  target: string;
  method?: string;
  start?: number;
  duration?: number;
  end?: number;
  shape?: string;
  path?: unknown;
  keyframes?: unknown[];
};

// Pick the tween most worth onion-shotting: one with an actual motion path or
// non-flat shape (i.e. it moves in space), preferring the longest.
function pickMovingSelector(tweens: Tween[]): string | null {
  const moving = tweens.filter((t) => t.path != null || (t.shape && t.shape !== "flat"));
  if (!moving.length) return null;
  moving.sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0));
  return moving[0].target || moving[0].id || null;
}

export async function POST(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const body = await req.json().catch(() => ({}));
  const slug = String(body.slug ?? "").trim();
  const wantShot = Boolean(body.shot);
  const samples = Math.min(Math.max(parseInt(String(body.samples ?? "9"), 10) || 9, 3), 24);
  let selector: string | null = typeof body.selector === "string" && body.selector.trim() ? body.selector.trim() : null;

  if (!/^[A-Za-z0-9_.-]+$/.test(slug)) {
    return NextResponse.json({ error: "invalid slug" }, { status: 400 });
  }
  const cwd = path.join(VIDEO_ROOT, slug);
  if (!existsSync(path.join(cwd, "index.html"))) {
    return NextResponse.json({ error: "project not found or missing index.html" }, { status: 404 });
  }
  if (!existsSync(HYPERFRAMES_BIN)) {
    return NextResponse.json({ error: "hyperframes CLI not found at " + HYPERFRAMES_BIN }, { status: 503 });
  }

  // 1) Machine-readable motion data (always).
  let motion: unknown = null;
  const warnings: string[] = [];
  try {
    const { stdout } = await run(HYPERFRAMES_BIN, ["keyframes", cwd, "--json"], {
      cwd,
      maxBuffer: 32 * 1024 * 1024,
      timeout: 90_000,
    });
    motion = JSON.parse(stdout);
  } catch (e) {
    return NextResponse.json(
      { error: "keyframes inspection failed", detail: String((e as Error).message).slice(0, 400) },
      { status: 500 },
    );
  }

  // Flatten tweens across compositions for selector auto-pick + summary count.
  const comps = (motion as { compositions?: { tweens?: Tween[] }[] })?.compositions ?? [];
  const allTweens: Tween[] = comps.flatMap((c) => c.tweens ?? []);
  if (!selector) selector = pickMovingSelector(allTweens);

  // 2) Optional onion-skin diagnostic PNG.
  let shot: { url: string; selector: string } | null = null;
  if (wantShot) {
    if (!selector) {
      warnings.push("No element with positional motion to onion-shot (animations are in-place, e.g. opacity/scale). Motion data still returned.");
    } else {
      const rel = path.join(".keyframes", `onion-${Date.now()}.png`);
      const out = path.join(cwd, rel);
      mkdirSync(path.dirname(out), { recursive: true });
      try {
        await run(
          HYPERFRAMES_BIN,
          ["keyframes", cwd, "--shot", out, "--selector", selector, "--samples", String(samples)],
          { cwd, maxBuffer: 16 * 1024 * 1024, timeout: 120_000 },
        );
        if (existsSync(out)) {
          shot = { url: `/api/video/preview/project/${encodeURIComponent(slug)}/${rel.split(path.sep).map(encodeURIComponent).join("/")}`, selector };
        } else {
          warnings.push("Onion-shot ran but produced no image for selector " + selector + ".");
        }
      } catch (e) {
        warnings.push("Onion-shot failed for " + selector + ": " + String((e as Error).message).slice(0, 200));
      }
    }
  }

  return NextResponse.json({
    slug,
    tweenCount: allTweens.length,
    selector,
    motion,
    shot,
    warnings,
  });
}
