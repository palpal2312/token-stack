import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { checkLocalRequest } from "@/lib/localOnly";
import { herdrBin } from "@/lib/herdr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Open a separate OS console running herdr.
 * On Windows: classic CMD window via `start … cmd /k` (not Windows Terminal, not
 * the dashboard PTY). Loopback + token only.
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

  const tried: string[] = [];

  if (process.platform === "win32") {
    // Same pattern as builder login: `start` gives a real console with a TTY.
    // windowsVerbatimArguments so cmd.exe does its own quoting.
    const safeBin = bin.replace(/"/g, "");
    const line = `start "Agent OS - Herdr" cmd /k "${safeBin}"`;
    if (await trySpawn("cmd.exe", ["/c", line], tried, { windowsVerbatimArguments: true })) {
      return NextResponse.json({ ok: true, via: "cmd" });
    }
  } else if (await trySpawn(bin, [], tried)) {
    return NextResponse.json({ ok: true, via: "direct" });
  }

  return NextResponse.json({
    error: `Could not open a CMD window (${tried.join("; ") || "no launcher worked"}). Run herdr yourself from a terminal.`,
  }, { status: 500 });
}

function trySpawn(
  cmd: string,
  args: string[],
  tried: string[],
  opts?: { windowsVerbatimArguments?: boolean },
): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args, {
        detached: true,
        stdio: "ignore",
        windowsHide: false,
        windowsVerbatimArguments: opts?.windowsVerbatimArguments,
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
