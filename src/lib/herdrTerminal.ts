// The embedded terminal behind the Code Space's Herdr panel.
//
// One real PTY (PowerShell via ConPTY) per dashboard server. It starts herdr so
// the page is a window into the same default session the rest of the Code Space
// aggregates — not a second session. When herdr exits, the shell stays open, so
// the panel degrades into an ordinary PowerShell instead of a dead rectangle.
//
// The session is deliberately a single global: the dashboard is single-user, and
// a second PTY would only double the ways the UI and the terminal disagree about
// who owns the herdr session. Restart kills and respawns this one.
//
// node-pty is required lazily inside startSession(): a broken native install
// (prebuild download failed, no build tools) must degrade to an explained error
// in the panel, not take the whole dashboard down at import time.

import { herdrBin } from "./herdr";

const COLS_DEFAULT = 120;
const ROWS_DEFAULT = 30;
const COLS_MIN = 20, COLS_MAX = 500;
const ROWS_MIN = 5, ROWS_MAX = 200;
// Output the terminal produced before anyone connected is replayed to the first
// subscriber, so a late-loading page still sees herdr's first frame. Bounded so
// a forgotten session cannot grow memory without limit.
const BACKLOG_MAX_CHARS = 1 << 20;

interface PtyLike {
  pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: { exitCode: number }) => void): void;
}

interface Session {
  pty: PtyLike;
  backlog: string;
  listeners: Set<(data: string) => void>;
  exited: boolean;
  exitCode: number | null;
}

interface Store { session: Session | null }

const globalKey = "__agenticOsHerdrTerminal";
const store: Store = (globalThis as Record<string, unknown>)[globalKey] as Store
  ?? ((globalThis as Record<string, unknown>)[globalKey] = { session: null });

export function clampCols(v: unknown): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return COLS_DEFAULT;
  return Math.min(COLS_MAX, Math.max(COLS_MIN, n));
}
export function clampRows(v: unknown): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return ROWS_DEFAULT;
  return Math.min(ROWS_MAX, Math.max(ROWS_MIN, n));
}

export interface TerminalState {
  running: boolean;
  pid: number | null;
  exited: boolean;
  exitCode: number | null;
}

export function terminalState(): TerminalState {
  const s = store.session;
  if (!s) return { running: false, pid: null, exited: false, exitCode: null };
  return { running: !s.exited, pid: s.pty.pid, exited: s.exited, exitCode: s.exitCode };
}

/**
 * Start the embedded terminal, or return the one already running.
 * PowerShell launches herdr first; `-NoExit` keeps the shell alive after herdr
 * quits (detach is `ctrl+b d`, which ends the TUI but not the server). When
 * herdr is not installed, the shell opens with a hint instead of failing.
 */
export async function startSession(cols: number, rows: number): Promise<{ ok: boolean; error: string | null }> {
  // Reuse the live PTY, but always re-sync size — a browser refresh often
  // reconnects with a different viewport than the ConPTY was spawned with.
  if (store.session && !store.session.exited) {
    resize(cols, rows);
    return { ok: true, error: null };
  }
  if (store.session?.exited) store.session = null;

  let pty: typeof import("node-pty");
  try {
    pty = await import("node-pty");
  } catch (e) {
    return { ok: false, error: `The terminal's native module (node-pty) failed to load: ${e instanceof Error ? e.message : e}. Reinstall dependencies in source/.` };
  }

  const bin = herdrBin();
  // Single quotes in PowerShell; a herdr path with a quote in it is not a thing
  // that exists in practice, but double them anyway — cheap correctness.
  const cmd = bin
    ? `& '${bin.replace(/'/g, "''")}'`
    : `Write-Host 'Herdr is not installed (set AGENTIC_OS_HERDR_BIN). This is a plain PowerShell.'`;

  // When the dashboard itself runs inside a Herdr pane, the environment carries
  // HERDR_* caller-context variables, and herdr refuses to start as "nested".
  // The embedded terminal is meant to be a *top-level* attach to the default
  // session, so the PTY gets a scrubbed environment: no HERDR_* at all, which
  // puts socket resolution back on the documented default path.
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !k.startsWith("HERDR_")) env[k] = v;
  }

  let proc: PtyLike;
  try {
    proc = pty.spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NoExit", "-Command", cmd], {
      name: "xterm-256color",
      cols, rows,
      cwd: process.env.USERPROFILE || process.cwd(),
      env,
      useConpty: true,
    }) as unknown as PtyLike;
  } catch (e) {
    return { ok: false, error: `Could not start PowerShell: ${e instanceof Error ? e.message : e}` };
  }

  const session: Session = { pty: proc, backlog: "", listeners: new Set(), exited: false, exitCode: null };
  proc.onData((data) => {
    session.backlog = (session.backlog + data).slice(-BACKLOG_MAX_CHARS);
    for (const cb of session.listeners) cb(data);
  });
  proc.onExit(({ exitCode }) => {
    session.exited = true;
    session.exitCode = exitCode;
    for (const cb of session.listeners) cb(`\r\n[process exited with code ${exitCode}]\r\n`);
  });
  store.session = session;
  return { ok: true, error: null };
}

export function writeInput(data: string): boolean {
  const s = store.session;
  if (!s || s.exited) return false;
  // A pasted dump is a legitimate input; a runaway client loop is not. 8 KB per
  // call is generous for keystrokes and pastes alike.
  s.pty.write(data.slice(0, 8192));
  return true;
}

export function resize(cols: number, rows: number): void {
  const s = store.session;
  if (!s || s.exited) return;
  try { s.pty.resize(cols, rows); } catch { /* resize races with exit; ignore */ }
}

export function killSession(): void {
  const s = store.session;
  if (!s) return;
  store.session = null;
  try { s.pty.kill(); } catch { /* already gone */ }
}

/**
 * Subscribe to terminal output. Replays the backlog first, then live chunks.
 * Returns an unsubscribe function.
 */
export function subscribe(cb: (data: string) => void): () => void {
  const s = store.session;
  if (!s) return () => {};
  if (s.backlog) cb(s.backlog);
  s.listeners.add(cb);
  return () => { s.listeners.delete(cb); };
}
