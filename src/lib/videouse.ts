// Video Editor (video-use) — the browser-use/video-use skill driven by the
// real Claude Code CLI, per job folder. Upload a video into a job dir, spawn
// `claude -p` there with an edit brief; the video-use skill (symlinked at
// ~/.claude/skills/video-use) transcribes via ElevenLabs Scribe, cuts at word
// boundaries, grades, burns captions and writes edit/final.mp4.
//
// Proven working end-to-end 2026-07-07 on a real 8.9-min video (49 segments,
// word-boundary cuts + burned captions) before this UI existed.

import { spawn } from "node:child_process";
import { existsSync, openSync, readFileSync } from "node:fs";
import { mkdir, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { glmcodeSpawnEnv, GLM_CODE_MODEL } from "@/lib/glmcode";

export const VIDEOUSE_ROOT = path.join(os.homedir(), ".agentic-os", "video-use-jobs");

// launchd starts the dev server with a minimal PATH; make sure `claude`,
// ffmpeg and uv resolve.
export const BIN_PATH = [
  path.join(os.homedir(), ".local/bin"),
  "/opt/homebrew/bin",
  "/usr/local/bin",
  path.join(os.homedir(), ".npm-global/bin"),
  process.env.PATH || "",
].filter(Boolean).join(":");

export function slugify(s: string): string {
  return (s.toLowerCase().replace(/\.[a-z0-9]+$/i, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "job");
}

export function jobDir(job: string): string {
  if (!/^[a-z0-9-]{1,60}$/.test(job)) throw new Error("bad job name");
  return path.join(VIDEOUSE_ROOT, job);
}

export interface VideoUseJob {
  name: string;
  mtime: number;
  sources: string[];       // video files in the job root
  hasFinal: boolean;
  running: boolean;
}

function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export function jobRunning(dir: string): boolean {
  const pidFile = path.join(dir, "run.pid");
  if (!existsSync(pidFile)) return false;
  const pid = parseInt(readFileSync(pidFile, "utf8").trim(), 10);
  return Number.isFinite(pid) && pidAlive(pid);
}

const VIDEO_EXT = new Set([".mp4", ".mov", ".webm", ".m4v", ".mkv"]);

export async function listJobs(): Promise<VideoUseJob[]> {
  await mkdir(VIDEOUSE_ROOT, { recursive: true });
  const out: VideoUseJob[] = [];
  for (const name of await readdir(VIDEOUSE_ROOT)) {
    const dir = path.join(VIDEOUSE_ROOT, name);
    try {
      const s = await stat(dir);
      if (!s.isDirectory()) continue;
      const files = await readdir(dir);
      const sources = files.filter((f) => VIDEO_EXT.has(path.extname(f).toLowerCase()));
      out.push({
        name,
        mtime: s.mtimeMs,
        sources,
        hasFinal: existsSync(path.join(dir, "edit", "final.mp4")),
        running: jobRunning(dir),
      });
    } catch { /* skip */ }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

// The brief handed to Claude Code. The video-use skill demands strategy
// confirmation before cutting (Hard Rule 11) — headless runs can't converse,
// so the brief pre-approves the plan and pins the output contract.
export function buildPrompt(instruction: string): string {
  return [
    "Use the video-use skill to edit the video file(s) in this folder.",
    `Edit brief from the user: ${instruction.trim()}`,
    "",
    "This is a headless run: the strategy in the brief is PRE-APPROVED — do not wait for confirmation.",
    "Follow every video-use Hard Rule (word-boundary cuts with 30–200ms pads, 30ms audio fades, subtitles last, per-segment extract + lossless concat).",
    "Write the finished video to edit/final.mp4 in this folder, then verify it plays (ffprobe duration > 0) before finishing.",
    "Keep a short human-readable summary of what you changed in edit/project.md.",
  ].join("\n");
}

// Runner: the standalone `claude` CLI login is flaky (recurring "Not logged
// in" even while subscriptions are active), so by default we drive Claude
// Code through the same env override GLM Code uses — the local Ollama
// Anthropic bridge running glm-5.2:cloud. No login, proven agentic, cheap.
// Set VIDEOUSE_RUNNER=anthropic to use the CLI's own login instead.
function runnerEnv(): { env: Record<string, string>; model?: string } {
  if (process.env.VIDEOUSE_RUNNER === "anthropic") return { env: {} };
  return { env: glmcodeSpawnEnv(), model: GLM_CODE_MODEL };
}

export function spawnEdit(dir: string, instruction: string): number {
  const logFd = openSync(path.join(dir, "run.log"), "a");
  const runner = runnerEnv();
  const args = [
    "-p", buildPrompt(instruction),
    "--output-format", "stream-json",
    "--verbose",
    "--permission-mode", "bypassPermissions",
  ];
  if (runner.model) args.push("--model", runner.model);
  const child = spawn("claude", args, {
    cwd: dir,
    env: { ...process.env, ...runner.env, PATH: BIN_PATH },
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  child.unref();
  return child.pid ?? -1;
}
