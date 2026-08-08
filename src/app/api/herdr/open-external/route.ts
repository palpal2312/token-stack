import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { checkLocalRequest } from "@/lib/localOnly";
import { herdrBin } from "@/lib/herdr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Open a real OS terminal running herdr (Windows Terminal when available).
 * Detached — does not nest inside the dashboard PTY. Loopback + token only.
 */
export async function POST(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const bin = herdrBin();
  if (!bin) {
    return NextResponse.json({
      error: "Herdr is not installed, or Agent OS cannot find it. Set AGENTIC_OS_HERDR_BIN or herdrBin in ~/.agentic-os/config.json.",
    }, { status: 404 });
  }

  // Prefer Windows Terminal (proper TUI); fall back to Start-Process on the binary.
  const tried: string[] = [];
  if (await trySpawn("wt.exe", [bin], tried)) {
    return NextResponse.json({ ok: true, via: "windows-terminal" });
  }
  if (await trySpawn("powershell.exe", [
    "-NoLogo", "-NoProfile", "-Command",
    `Start-Process -FilePath '${bin.replace(/'/g, "''")}'`,
  ], tried)) {
    return NextResponse.json({ ok: true, via: "start-process" });
  }

  return NextResponse.json({
    error: `Could not open an external terminal (${tried.join("; ") || "no launcher worked"}). Run herdr yourself from a terminal.`,
  }, { status: 500 });
}

function trySpawn(cmd: string, args: string[], tried: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args, {
        detached: true,
        stdio: "ignore",
        windowsHide: false,
        env: process.env,
      });
      child.on("error", (e) => {
        tried.push(`${cmd}: ${e.message}`);
        resolve(false);
      });
      // Spawn success is enough — do not wait for herdr to exit.
      child.unref();
      // Give a tick for immediate spawn failures (ENOENT).
      setTimeout(() => resolve(true), 80);
    } catch (e) {
      tried.push(`${cmd}: ${e instanceof Error ? e.message : String(e)}`);
      resolve(false);
    }
  });
}
