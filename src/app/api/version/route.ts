import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Reads the VERSION file the export stamps (source/VERSION, e.g. "2026-07-07") so the
// dashboard can show which pack build the member is running. ponytail: one file read,
// no build-time env plumbing — the export already writes VERSION every release.
export function GET() {
  let version = "";
  for (const p of [path.join(process.cwd(), "VERSION"), path.join(process.cwd(), "..", "VERSION")]) {
    try { version = readFileSync(p, "utf8").trim(); if (version) break; } catch { /* try next */ }
  }
  return NextResponse.json({ version: version || "unknown" });
}
