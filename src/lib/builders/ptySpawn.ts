// PTY spawn path for CLIs that refuse to run without a console.
//
// Verified on this machine 2026-07-28 (agy.exe 1.1.8): spawned on a plain pipe
// the process exits instantly — no stdout, no stderr, null exit code — while
// the same argv under a ConPTY runs normally. A CliSpec opts in with
// `requiresPty`, and the chat lane (runBuilderChat) spawns through here instead
// of child_process.spawn.
//
// loadPtySpawn() returns a spawner whose result quacks like the ChildProcess
// the lane already drives — pid, stdout/stderr "data" events, error/close,
// kill() — so timeout, abort and streaming semantics stay the lane's own code;
// only the spawn line differs. The differences a PTY forces, and how they are
// absorbed:
//
//   - stdout and stderr are one stream. Everything arrives on `stdout`;
//     `stderr` stays silent (the lane shows stderr as UI notes; PTY noise is
//     ANSI control bytes, not prose, so nothing of value is lost).
//   - stdin is the console. The prompt travels in argv for every CLI here, so
//     stdin is a no-op stub (the lane closes it immediately anyway).
//   - Output carries terminal control bytes. PtyTextCleaner strips ANSI CSI
//     and OSC sequences statefully (a sequence can straddle two chunks), turns
//     \r\n into \n, and lets a bare \r restart the current line so spinner
//     frames overwrite instead of accumulate.
//
// node-pty is imported lazily, same rule as herdrTerminal: a broken native
// install must fail this lane with an explained error, not take the whole
// dashboard down at import time.

import { EventEmitter } from "node:events";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { agentEnv, type RunResult } from "../runner";

const COLS = 160;
const ROWS = 48;

/** node-pty's IPty, typed locally so the lazy import stays the only reference. */
interface PtyProc {
  pid: number;
  write(data: string): void;
  kill(): void;
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: { exitCode: number }) => void): void;
}

// A PTY echoes HERDR_* caller-context down to any herdr the child might start,
// which herdr reads as "nested" and refuses. The embedded terminal scrubs the
// same variables (see herdrTerminal.ts); a chat lane is a top-level spawn too.
function scrubEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined && !k.startsWith("HERDR_")) out[k] = v;
  }
  return out;
}

// ------------------------------------------------------------------ text clean

const CSI = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

/** Does `tail` (which starts at an ESC) hold a complete escape sequence? */
function isCompleteEscape(tail: string): boolean {
  if (tail.length < 2) return false;
  const kind = tail[1];
  if (kind === "[") return /[@-~]/.test(tail.slice(2));
  if (kind === "]") return tail.includes("\x07") || tail.includes("\x1b\\");
  return true; // two-byte escapes (ESC + one char) are complete at length 2
}

/**
 * Stateful PTY output cleaner. Chunks do not respect escape-sequence
 * boundaries, so a trailing partial sequence is held back until the rest of it
 * arrives; only resolved, printable text is handed on.
 */
export class PtyTextCleaner {
  private hold = "";

  push(raw: string): string {
    let s = this.hold + raw;
    this.hold = "";
    const escStart = s.lastIndexOf("\x1b");
    if (escStart >= 0) {
      const tail = s.slice(escStart);
      if (!isCompleteEscape(tail)) {
        this.hold = tail;
        s = s.slice(0, escStart);
      }
    }
    s = s.replace(CSI, "").replace(OSC, "").replace(/\r\n/g, "\n");
    if (s.includes("\r")) {
      // Terminal semantics for a bare carriage return: the line restarts.
      // Applied within this chunk — a spinner frame overwrites what it redrew
      // here instead of accumulating glyphs in the reply.
      let out = "";
      let cur = "";
      for (const ch of s) {
        if (ch === "\r") cur = "";
        else if (ch === "\n") { out += cur + "\n"; cur = ""; }
        else cur += ch;
      }
      s = out + cur;
    }
    return s;
  }

  /** Whatever is still held at exit (a truncated escape is dropped). */
  flush(): string {
    const rest = this.hold.replace(CSI, "").replace(OSC, "");
    this.hold = "";
    return rest;
  }
}

// -------------------------------------------------------------------- adapter

export interface PtySpawnOpts {
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export type PtySpawnFn = (bin: string, args: readonly string[], opts: PtySpawnOpts) => ChildProcessWithoutNullStreams;

function adapt(proc: PtyProc): ChildProcessWithoutNullStreams {
  const self = new EventEmitter();
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const cleaner = new PtyTextCleaner();
  proc.onData((d) => {
    const clean = cleaner.push(d);
    if (clean) stdout.emit("data", Buffer.from(clean, "utf8"));
  });
  proc.onExit(({ exitCode }) => {
    const tail = cleaner.flush();
    if (tail) stdout.emit("data", Buffer.from(tail, "utf8"));
    self.emit("close", exitCode);
  });
  const child = {
    pid: proc.pid,
    // The prompt is in argv and the lane closes stdin immediately; the console
    // needs neither. write() exists so a future caller compiles, not to be used.
    stdin: { write(_d: string): void { /* console input is not wired up */ }, end(): void { /* nothing to close */ } },
    stdout,
    stderr,
    on: self.on.bind(self),
    once: self.once.bind(self),
    kill(_signal?: string): void {
      try { proc.kill(); } catch { /* already gone */ }
    },
  };
  return child as unknown as ChildProcessWithoutNullStreams;
}

/**
 * Load node-pty and return a spawner with child_process.spawn's shape. Throws
 * when the native module is broken — the caller turns that into an explained
 * per-lane failure.
 */
export async function loadPtySpawn(): Promise<PtySpawnFn> {
  const pty = await import("node-pty");
  return (bin, args, opts) => adapt(pty.spawn(bin, [...args], {
    name: "xterm-256color",
    cols: COLS,
    rows: ROWS,
    cwd: opts.cwd,
    env: scrubEnv(opts.env),
    useConpty: true,
  }) as unknown as PtyProc);
}

/**
 * Collect-all variant with run()'s result shape, for one-shot callers (the
 * legacy /api/antigravity/chat route) that want a promise of full output
 * rather than a stream. Same PTY, same cleanup, same HERDR_* scrub; the
 * timeout kills the PTY and resolves with what arrived, like run() does.
 */
export function ptyRun(
  bin: string,
  args: readonly string[],
  opts: { timeoutMs?: number; cwd?: string; extraEnv?: Record<string, string> } = {},
): Promise<RunResult> {
  const started = Date.now();
  const timeoutMs = opts.timeoutMs ?? 15_000;
  return (async () => {
    const spawnPty = await loadPtySpawn();
    return new Promise<RunResult>((resolve) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawnPty(bin, args, {
          cwd: opts.cwd ?? process.cwd(),
          env: agentEnv(opts.extraEnv ?? {}),
        });
      } catch (e) {
        resolve({ ok: false, code: -1, stdout: "", stderr: String((e as Error)?.message ?? e), durationMs: Date.now() - started });
        return;
      }
      let stdout = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        try { child.kill(); } catch { /* gone */ }
        settled = true;
        resolve({ ok: false, code: null, stdout, stderr: `Timed out after ${Math.round(timeoutMs / 1000)}s.`, durationMs: Date.now() - started });
      }, timeoutMs);
      child.stdout.on("data", (b: Buffer) => { stdout += b.toString(); });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: code === 0, code: code as number | null, stdout, stderr: "", durationMs: Date.now() - started });
      });
    });
  })().catch((e) => ({
    ok: false, code: -1, stdout: "", stderr: String((e as Error)?.message ?? e), durationMs: Date.now() - started,
  }));
}
