import { NextResponse } from "next/server";
import { readdir } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Which demo clips actually exist in the pack. The openmontage page renders a
 * <video> only for these — referencing an absent mp4 is a guaranteed 404 the
 * user can see, and the missing-assets test was right to complain about.
 * Files added later appear here automatically (no code change).
 */
export async function GET() {
  const root = path.join(process.cwd(), "public", "openmontage");
  const videos: string[] = [];
  async function walk(dir: string) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.name.toLowerCase().endsWith(".mp4")) {
        videos.push("/openmontage" + full.slice(root.length).replace(/\\/g, "/"));
      }
    }
  }
  await walk(root);
  return NextResponse.json({ videos });
}
