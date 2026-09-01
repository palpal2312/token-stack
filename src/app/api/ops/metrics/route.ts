import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// S18 P2: read the tail of the SLO probe series (last N rows) for the dashboard.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const n = Math.min(200, Number(url.searchParams.get("n") ?? 50) || 50);
  const file = join(homedir(), ".agentic-os", "..", "AppData", "Local", "NEWSOS", "s12-metrics", "slo.jsonl");
  try {
    const lines = readFileSync(file, "utf8").split("\n").filter(Boolean).slice(-n);
    const rows = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    return NextResponse.json({ series: rows });
  } catch {
    return NextResponse.json({ series: [], note: "no SLO series yet" });
  }
}
