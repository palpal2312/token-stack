import { spawn, execFile, type ChildProcessWithoutNullStreams, type ChildProcess } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { config } from "./config";

const IS_WINDOWS = process.platform === "win32";

// "fcc" is the Free Claude Code agent — it runs the same `claude` CLI but with
// the local fcc-server proxy env vars injected, routing requests to OpenRouter
// / NVIDIA NIM / Kimi / etc instead of api.anthropic.com.
// "codex" is OpenAI's Codex CLI (≥ 0.125 — supports `codex exec --json` for streaming).
export type AgentName = "claude" | "openclaw" | "hermes" | "antigravity" | "fcc" | "codex" | "kimi" | "grok" | "ruflo" | "ant";

function binFor(agent: AgentName, override?: string | null): string {
  // A Builder profile can pin its own binary — that is how one CLI hosts several
  // installs, and how a profile works at all on Windows, where the config's
  // auto-detected value is often an unspawnable .cmd shim.
  if (override) return override;
  // fcc is a virtual agent — it spawns the regular claude binary, just with
  // different env vars (see fccSpawnEnv in lib/fcc.ts).
  const key = agent === "fcc" ? "claude" : agent;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bin = (config as any)[key];
  if (!bin) throw new Error(`${agent} is not installed or not configured. Set AGENTIC_OS_${key.toUpperCase()}_BIN or install the CLI.`);
  return bin;
}

/** Overrides a Builder profile contributes to a spawn. */
export interface BuilderOverrides {
  /** Absolute path to the binary this profile runs. */
  binOverride?: string | null;
  /** Args inserted before the caller's args (e.g. the fixture's script path). */
  argsPrefix?: readonly string[];
}

// Build an env that agents can actually run subprocesses inside. The Next.js dev server's
// own process.env can be missing SHELL or have a stripped PATH, which causes Antigravity to
// crash mid-task with `fork/exec /bin/zsh: no such file or directory` and similar.
//
// This must stay platform-correct, not just platform-tolerant: Builder profiles isolate
// accounts by handing the child a CLAUDE_CONFIG_DIR / CODEX_HOME / KIMI_CODE_HOME. If this
// function overwrote HOME with a POSIX path on Windows, a CLI that resolves its config
// relative to HOME would land somewhere neither profile owns, and two "separate" accounts
// would quietly share one login.
//
// Phase 20 secret transport: the inherited base never forwards secret-bearing
// keys (names like *_API_KEY/*_TOKEN/*_SECRET or values that look like opaque
// credentials) to the child. Builder credentials travel deliberately through
// the Builder profile (`extra`), not through broad environment inheritance.
const INHERITED_SECRET_KEY = /(?:^|_)(?:api[_-]?key|auth[_-]?token|access[_-]?token|refresh[_-]?token|session[_-]?token|secret|token|key|password|passwd|credential|private[_-]?key|session[_-]?key|secret[_-]?key|access[_-]?key)(?:$|_)/i;
const INHERITED_SECRET_VALUE = /(?:\bbearer\s+[a-z0-9._~+/-]{8,}=*|\bsk-[a-z0-9_-]{8,}\b|\bghp_[a-z0-9]{8,}\b|\bgithub_pat_[a-z0-9_]{8,}\b|\bglpat-[a-z0-9_-]{8,}\b|\bxox[bap]-[a-z0-9-]{8,}\b|\bakia[a-z0-9]{8,}\b|\baiza[a-z0-9_-]{8,}\b|\beyj[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\b|[a-z][a-z0-9+.-]*:\/\/[^:/\s]*:[^@\s]{6,}@|-----begin [^-]*private key-----)/i;

/** Keys the child always needs regardless of their name shape. Proxy URLs are
 * allowlisted deliberately — a child behind a corporate proxy needs them even
 * when they embed basic-auth credentials. */
const INHERITED_ALLOW_ALWAYS = new Set([
  "PATH", "PATHEXT", "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "SHELL", "COMSPEC",
  "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "TEMP", "TMP", "TMPDIR", "APPDATA", "LOCALAPPDATA",
  "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMW6432", "COMMONPROGRAMFILES",
  "OS", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "COMPUTERNAME", "USERNAME", "USER",
  "LOGNAME", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "TERM", "COLORTERM", "TERM_PROGRAM",
  "DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME",
  "XDG_CACHE_HOME", "SSH_AUTH_SOCK", "GIT_SSH", "GIT_SSH_COMMAND",
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY",
  "AGENTIC_OS_HOME", "AGENTIC_OS_HERDR_BIN", "AGENTIC_OS_ALLOW_TEST_FIXTURE",
  "CODEX_HOME", "CLAUDE_CONFIG_DIR", "KIMI_CODE_HOME", "AGENTIC_OS_NEXT_DIST_DIR",
  "NODE_ENV", "PORT", "FORCE_COLOR", "NO_COLOR",
]);

export function agentEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const base = scrubInheritedEnv(process.env);
  const home = os.homedir();
  const sep = IS_WINDOWS ? ";" : ":";
  const ensurePath = IS_WINDOWS
    ? [
        path.join(home, ".local", "bin"),
        path.join(home, ".kimi-code", "bin"),
        path.join(home, ".grok", "bin"),
        path.join(home, "AppData", "Roaming", "npm"),
      ]
    : [
        "/usr/local/bin",
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
        path.join(home, ".local", "bin"),
        path.join(home, "local", "node", "bin"),
        path.join(home, ".kimi-code", "bin"),
      ];
  // Windows env keys are case-insensitive; Node exposes whatever case the parent used.
  const pathKey = IS_WINDOWS
    ? (Object.keys(base).find((k) => k.toUpperCase() === "PATH") ?? "Path")
    : "PATH";
  const existing = (base[pathKey] ?? "").split(sep).filter(Boolean);
  const merged = [...new Set([...existing, ...ensurePath])].join(sep);

  const env: NodeJS.ProcessEnv = {
    ...base,
    [pathKey]: merged,
    NO_COLOR: "1",
    FORCE_COLOR: "0",
  };
  if (!IS_WINDOWS) {
    env.SHELL = base.SHELL || "/bin/zsh";
    env.HOME = base.HOME || home;
  }
  // Applied last so a Builder's isolation vars always win.
  return { ...env, ...extra };
}

/**
 * Drop inherited keys that look secret-bearing. A key survives when it is on
 * the operational allowlist, or when neither its name nor its value matches a
 * secret shape. Anything a Builder needs arrives via `extra` instead.
 */
export function scrubInheritedEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue;
    if (INHERITED_ALLOW_ALWAYS.has(key.toUpperCase())) { out[key] = value; continue; }
    if (INHERITED_SECRET_KEY.test(key)) continue;
    if (INHERITED_SECRET_VALUE.test(value)) continue;
    out[key] = value;
  }
  return out as NodeJS.ProcessEnv;
}

/** Where a spawned agent runs when the caller has no opinion. */
function defaultCwd(): string { return os.homedir(); }

/**
 * Kill a child and everything it started.
 *
 * `child.kill()` signals only the direct child. Every CLI here spawns its own
 * workers, so on Windows a "timed out" Arena lane would otherwise keep running —
 * and keep spending tokens — after the UI called it dead.
 */
export function killTree(child: ChildProcess): void {
  const pid = child.pid;
  if (!pid) return;
  if (IS_WINDOWS) {
    // Detached so a slow taskkill cannot hold the request open; failures are
    // expected and harmless when the tree already exited.
    try {
      execFile("taskkill", ["/PID", String(pid), "/T", "/F"], () => {});
    } catch { /* fall through to the direct kill below */ }
  } else {
    try { process.kill(-pid, "SIGKILL"); } catch { /* no process group */ }
  }
  try { child.kill("SIGKILL"); } catch {}
}

const FLAG_PATTERN = /^[A-Za-z0-9_\-./:=,@+%]+$/;
const MAX_ARG_LEN = 32_000;

export function validateFlagArgs(args: readonly string[]): string[] {
  return args.filter((a) => typeof a === "string" && a.length < MAX_ARG_LEN && FLAG_PATTERN.test(a));
}

function safeArg(a: unknown): string | null {
  if (typeof a !== "string") return null;
  if (a.length === 0 || a.length > MAX_ARG_LEN) return null;
  if (a.includes("\0")) return null;
  return a;
}

export interface RunResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export async function run(
  agent: AgentName,
  args: readonly string[],
  opts: {
    timeoutMs?: number; cwd?: string; input?: string;
    extraEnv?: Record<string, string>;
  } & BuilderOverrides = {}
): Promise<RunResult> {
  const cleanArgs = [...(opts.argsPrefix ?? []), ...args]
    .map(safeArg).filter((a): a is string => a !== null);
  const started = Date.now();

  let bin: string;
  try { bin = binFor(agent, opts.binOverride); }
  catch (e) {
    return { ok: false, code: -1, stdout: "", stderr: String(e), durationMs: 0 };
  }

  return new Promise<RunResult>((resolve) => {
    const child = spawn(bin, cleanArgs, {
      cwd: opts.cwd ?? defaultCwd(),
      env: agentEnv(opts.extraEnv ?? {}),
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      killTree(child);
    }, opts.timeoutMs ?? 15_000);

    child.stdout.on("data", (b) => { stdout += b.toString(); });
    child.stderr.on("data", (b) => { stderr += b.toString(); });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ ok: code === 0, code, stdout, stderr, durationMs: Date.now() - started });
    });
    child.on("error", (e) => {
      clearTimeout(timeout);
      resolve({ ok: false, code: -1, stdout, stderr: String(e), durationMs: Date.now() - started });
    });

    if (opts.input) child.stdin.write(opts.input);
    try { child.stdin.end(); } catch {}
  });
}

export function spawnStream(
  agent: AgentName,
  args: readonly string[],
  opts: { cwd?: string; input?: string; extraEnv?: Record<string, string> } & BuilderOverrides = {}
): ChildProcessWithoutNullStreams {
  const bin = binFor(agent, opts.binOverride);
  const cleanArgs = [...(opts.argsPrefix ?? []), ...args]
    .map(safeArg).filter((a): a is string => a !== null);
  const child = spawn(bin, cleanArgs, {
    cwd: opts.cwd ?? defaultCwd(),
    env: agentEnv(opts.extraEnv ?? {}),
    stdio: ["pipe", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams;
  if (typeof opts.input === "string" && opts.input.length > 0) {
    // Write the prompt to stdin (no OS arg-length limit, no per-arg cap).
    child.stdin.write(opts.input);
  }
  try { child.stdin.end(); } catch {}
  return child;
}
