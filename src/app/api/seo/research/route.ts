import { execFile } from "node:child_process";
import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { promisify } from "node:util";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { config } from "@/lib/config";

const pexec = promisify(execFile);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The Research tab runs live, read-only Google Search Console keyword research.
// The member authorizes their OWN GSC once (scripts/gsc-connect.py), which caches a
// read-only token + their verified-site list under ~/.agentic-os/gsc-*.
const AOS = path.join(os.homedir(), ".agentic-os");
// gsc-research.py ships in the pack (scripts/); prefer the bundled copy, fall back to
// a user-installed one under ~/.agentic-os for older setups.
const BUNDLED = path.join(process.cwd(), "scripts", "gsc-research.py");
const SCRIPT = existsSync(BUNDLED) ? BUNDLED : path.join(AOS, "gsc-research.py");
const TOKEN = path.join(AOS, "gsc-token.json");
const LATEST = path.join(AOS, "gsc-latest.json");
const PY = "/usr/bin/python3"; // has the google-api libs; absolute so launchd PATH can't break it
// No hardcoded sites — the member's verified properties come from gsc-latest.json after
// they connect. config.seoSites is an optional pre-connect hint; default is empty.
const KNOWN_SITES: string[] = Array.isArray(config.seoSites) ? config.seoSites : [];

// GET → connection status + the verified GSC properties (from the fresh cached pull).
export async function GET() {
  let sites = KNOWN_SITES;
  try {
    if (existsSync(LATEST)) {
      const keys = Object.keys(JSON.parse(readFileSync(LATEST, "utf8")));
      if (keys.length) sites = keys;
    }
  } catch { /* fall back to the known set */ }
  return Response.json(
    { connected: existsSync(TOKEN), hasScript: existsSync(SCRIPT), sites },
    { headers: { "cache-control": "no-store" } },
  );
}

// Run gsc-research.py for ONE site and return the parsed result (or {error}).
async function researchSite(site: string, d: string, seedWords: string[]): Promise<Record<string, unknown>> {
  const args = [SCRIPT, site, d, ...seedWords];
  try {
    const { stdout } = await pexec(PY, args, {
      timeout: 90_000,
      maxBuffer: 12 * 1024 * 1024,
      env: { ...process.env, PYTHONWARNINGS: "ignore" },
    });
    const line = stdout.trim().split("\n").filter(Boolean).pop() || "{}";
    return JSON.parse(line);
  } catch (e: unknown) {
    const out = (e as { stdout?: string })?.stdout;
    if (out) { try { return JSON.parse(out.trim().split("\n").filter(Boolean).pop() || "{}"); } catch { /* ignore */ } }
    return { error: "GSC research failed — run `python3 scripts/gsc-connect.py` once to connect (or refresh) your Search Console." };
  }
}

function connectedSites(): string[] {
  try {
    if (existsSync(LATEST)) {
      const keys = Object.keys(JSON.parse(readFileSync(LATEST, "utf8")));
      if (keys.length) return keys;
    }
  } catch { /* fall back */ }
  return KNOWN_SITES;
}

// POST {site, days, seed} → live GSC research + scored opportunities.
// site === "all" → run every connected site in parallel and merge the topics (each tagged with its site).
export async function POST(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  if (!existsSync(SCRIPT)) return Response.json({ error: "research script missing" }, { status: 500 });
  const { site, days, seed } = await req.json().catch(() => ({}));
  const isAll = site === "all";
  if (!isAll && (!site || typeof site !== "string" || !/^[a-z0-9.-]+$/i.test(site))) {
    return Response.json({ error: "bad site" }, { status: 400 });
  }
  const d = String(Math.min(Math.max(parseInt(String(days), 10) || 28, 7), 365));
  const seedWords: string[] = [];
  if (seed && typeof seed === "string") {
    for (const w of seed.slice(0, 80).split(/\s+/).filter(Boolean).slice(0, 8)) seedWords.push(w);
  }

  if (isAll) {
    const sites = connectedSites();
    const settled = await Promise.all(sites.map((s) => researchSite(s, d, seedWords).then((r) => ({ s, r }))));
    const ok = settled.filter(({ r }) => !r.error);
    if (!ok.length) {
      const firstErr = settled.find(({ r }) => r.error)?.r.error as string | undefined;
      return Response.json({ error: firstErr || "No sites returned data." }, { status: 502, headers: { "cache-control": "no-store" } });
    }
    // Merge every site's topics, tagging each with its site; rank the combined list by score.
    const merged: Record<string, unknown>[] = ok.flatMap(({ s, r }) => ((r.topics as Record<string, unknown>[]) || []).map((t) => ({ ...t, site: s })));
    merged.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
    const topics = merged.slice(0, 250);
    const sum = (k: string) => ok.reduce((n, { r }) => n + (Number(r[k]) || 0), 0);
    const win = (ok[0].r.window as [string, string]) || ["", ""];
    return Response.json({
      site: "all", property: `all sites (${ok.length})`, days: Number(d), window: win,
      totalQueries: sum("totalQueries"), totalImpressions: sum("totalImpressions"), totalClicks: sum("totalClicks"),
      topics, sites: ok.map(({ s }) => s),
      skipped: settled.filter(({ r }) => r.error).map(({ s }) => s),
    }, { headers: { "cache-control": "no-store" } });
  }

  const data = await researchSite(site, d, seedWords);
  if (data.error) return Response.json(data, { status: 502, headers: { "cache-control": "no-store" } });
  return Response.json(data, { headers: { "cache-control": "no-store" } });
}
