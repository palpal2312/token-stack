import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { config } from "@/lib/config";
import { checkLocalRequest } from "@/lib/localOnly";

// Lifecycle for the Hermes web dashboard (FastAPI on :9119). Agent OS embeds it
// in the Hermes → Manage tab so you can configure model/provider, API keys,
// sessions, cron, skills, MCP, channels, logs, analytics and system ops without
// leaving Agent OS. GET = status; POST = ensure it's running (start if down).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DASH_URL = "http://127.0.0.1:9119";

async function isUp(): Promise<boolean> {
  try {
    const r = await fetch(`${DASH_URL}/api/status`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function GET() {
  return NextResponse.json({ running: await isUp(), url: DASH_URL });
}

export async function POST(req: Request) {
  // No body is read — a bare cross-origin POST would otherwise start the dashboard process.
  const guard = checkLocalRequest(req, { requireJson: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  if (await isUp()) {
    return NextResponse.json({ running: true, url: DASH_URL, started: false });
  }

  const bin = config.hermes ?? "hermes";
  try {
    // --no-open keeps it headless (we frame it). Note: Hermes ≥0.16 dropped the
    // old --tui flag, so passing it errors — keep the args minimal.
    const child = spawn(bin, ["dashboard", "--no-open", "--port", "9119"], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env },
    });
    // A missing hermes binary does not throw here — it fails asynchronously as
    // an "error" event on the child. Without a listener that becomes an
    // uncaughtException and takes the whole dashboard down; capture it and
    // answer with an explained failure instead.
    const spawnError = await new Promise<Error | null>((resolve) => {
      child.once("error", resolve);
      setTimeout(() => resolve(null), 500);
    });
    if (spawnError) {
      return NextResponse.json({
        running: false, url: DASH_URL,
        error: `Could not start the Hermes dashboard: ${spawnError.message}. Is the hermes CLI installed and on PATH?`,
      }, { status: 500 });
    }
    child.unref();
  } catch (e) {
    return NextResponse.json({ running: false, url: DASH_URL, error: String(e) }, { status: 500 });
  }

  // First launch may build the frontend; poll up to ~30s.
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await isUp()) {
      return NextResponse.json({ running: true, url: DASH_URL, started: true });
    }
  }
  return NextResponse.json({
    running: false,
    url: DASH_URL,
    started: true,
    warn: "Dashboard is still starting (first launch builds the UI). Try Refresh in a few seconds.",
  });
}
