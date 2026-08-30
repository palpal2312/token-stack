// Herdr — the terminal workspace manager behind the Code Space.
//
// Herdr (github.com/ogulcancelik/herdr, Apache-2.0) runs real coding agents in
// persistent terminal panes and reports what each one is doing. Agent OS drives
// it through the documented `herdr <noun> <verb>` CLI wrappers, which print one
// JSON object on stdout, rather than the raw socket: the wrappers are the stable
// layer, and the socket transport is the part still marked experimental on Windows.
//
// Not routed through runner.ts on purpose. `run()` resolves binaries via the
// AgentName union and the config keys behind it; Herdr is not an agent, and
// widening that union to fit a multiplexer would make every agent lookup vaguer.
//
// Everything here is time-boxed and failure-tolerant. Herdr is optional: when it
// is missing or its server is down, each call returns an explained failure and the
// Code Space shows guidance instead of breaking.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { config } from "./config";
import { agentEnv } from "./runner";
import { readDaemonHerdrSnapshot } from "./agentRuntime/go-builder-exec-client";

const DEFAULT_TIMEOUT_MS = 5_000;

export function herdrBin(): string | null {
  const bin = config.herdrBin;
  return bin && existsSync(bin) ? bin : null;
}

export interface HerdrResult<T = unknown> {
  ok: boolean;
  data: T | null;
  /** A sentence explaining the failure, suitable for showing to the user. */
  error: string | null;
  raw: string;
}

/**
 * Herdr reports failures two ways, and both arrive on stdout with exit 1:
 * wrapped, `{"error":{"code","message"},"id":"cli:pane:close"}`, and bare,
 * `{"code","message"}` (what `pane read` sends). Returns the message when the
 * text is either shape, else null.
 */
function errorMessageIn(raw: string): string | null {
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return null; }
  if (!j || typeof j !== "object") return null;
  const o = j as { error?: unknown; code?: unknown; message?: unknown };
  const err = o.error ?? (typeof o.code === "string" && typeof o.message === "string" ? o : null);
  if (!err) return null;
  if (typeof err === "string") return err;
  const m = (err as { message?: unknown }).message;
  return typeof m === "string" ? m : "unknown error";
}

/** Run one herdr CLI command and parse its JSON reply. */
export async function execHerdr<T = unknown>(
  args: string[],
  opts: { timeoutMs?: number } = {},
): Promise<HerdrResult<T>> {
  const bin = herdrBin();
  if (!bin) {
    return { ok: false, data: null, raw: "", error: "Herdr is not installed, or Agent OS cannot find it. Set AGENTIC_OS_HERDR_BIN or \"herdrBin\" in ~/.agentic-os/config.json." };
  }

  const res = await new Promise<{ err: Error | null; stdout: string; stderr: string }>((resolve) => {
    execFile(bin, args, {
      env: agentEnv(),
      timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 8 << 20,       // a snapshot of a busy session is large
    }, (err, stdout, stderr) => resolve({ err, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") }));
  });

  const raw = res.stdout.trim();

  const refusal = errorMessageIn(raw);
  if (refusal) return { ok: false, data: null, raw, error: `Herdr refused: ${refusal}` };

  if (res.err) {
    const detail = res.stderr.trim().split("\n")[0] || raw.slice(0, 200) || res.err.message;
    return { ok: false, data: null, raw, error: `herdr ${args.slice(0, 2).join(" ")} failed: ${detail}` };
  }

  // The verbs that only act (`pane run`, `pane send-text`) print nothing and exit
  // 0. Silence after a clean exit is success, not a malformed reply.
  if (!raw) return { ok: true, data: null, raw, error: null };

  // Some verbs (pane read) return terminal text, not JSON. Callers that expect
  // text use execHerdrText; here a non-JSON body is reported rather than guessed at.
  let parsed: { result?: T };
  try { parsed = JSON.parse(raw); }
  catch {
    return { ok: false, data: null, raw, error: `herdr replied with something that is not JSON: ${raw.slice(0, 200)}` };
  }
  return { ok: true, data: (parsed.result ?? null) as T, raw, error: null };
}

/** For verbs that return terminal text rather than JSON. */
export async function execHerdrText(args: string[], opts: { timeoutMs?: number } = {}): Promise<HerdrResult<string>> {
  const bin = herdrBin();
  if (!bin) return { ok: false, data: null, raw: "", error: "Herdr is not installed." };
  const res = await new Promise<{ err: Error | null; stdout: string; stderr: string }>((resolve) => {
    execFile(bin, args, { env: agentEnv(), timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, windowsHide: true, maxBuffer: 4 << 20 },
      (err, stdout, stderr) => resolve({ err, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") }));
  });
  // A failed `pane read` still writes to stdout — a bare {"code","message"} JSON
  // object. Returning that as pane text would print Herdr's error into the
  // terminal view as if the agent had said it, so failures are caught first.
  if (res.err) {
    const detail = errorMessageIn(res.stdout.trim())
      ?? res.stderr.trim().split("\n")[0]
      ?? res.err.message;
    return { ok: false, data: null, raw: res.stdout, error: detail || res.err.message };
  }
  return { ok: true, data: res.stdout, raw: res.stdout, error: null };
}

// ------------------------------------------------------------------- snapshot

export interface HerdrAgent {
  agent?: string;
  agent_status?: "idle" | "working" | "blocked" | "unknown";
  cwd?: string;
  focused?: boolean;
  pane_id?: string;
  tab_id?: string;
  workspace_id?: string;
  terminal_id?: string;
  terminal_title?: string;
  terminal_title_stripped?: string;
  agent_session?: { agent?: string; value?: string };
}

export interface HerdrPane extends HerdrAgent { revision?: number }

export interface HerdrWorkspace {
  workspace_id: string;
  label?: string;
  number?: number;
  agent_status?: string;
  pane_count?: number;
  tab_count?: number;
  focused?: boolean;
  active_tab_id?: string;
}

export interface HerdrTab {
  tab_id: string; workspace_id: string; label?: string; number?: number;
  agent_status?: string; pane_count?: number; focused?: boolean;
}

export interface HerdrSnapshot {
  agents: HerdrAgent[];
  panes: HerdrPane[];
  tabs: HerdrTab[];
  workspaces: HerdrWorkspace[];
  version?: string;
  protocol?: number;
  focused_pane_id?: string;
  focused_workspace_id?: string;
}

export interface HerdrStatus {
  installed: boolean;
  bin: string | null;
  version: string | null;
  running: boolean;
  /** Present only when something is wrong; always phrased as a next step. */
  error: string | null;
}

export async function herdrStatus(): Promise<HerdrStatus> {
  const bin = herdrBin();
  if (!bin) {
    return {
      installed: false, bin: null, version: null, running: false,
      error: "Herdr is not installed. It runs your coding agents in persistent terminal panes; the Code Space reads and drives that session.",
    };
  }

  const ver = await execHerdrText(["--version"], { timeoutMs: 2_000 });
  const version = ver.data?.trim().split(/\s+/)[1] ?? null;

  const snap = await execHerdr<{ snapshot?: HerdrSnapshot }>(["api", "snapshot"], { timeoutMs: 3_000 });
  if (!snap.ok) {
    return {
      installed: true, bin, version, running: false,
      error: "Herdr is installed but its server is not answering. Open a terminal and run `herdr` to start a session — the Code Space attaches to whatever is already running.",
    };
  }
  return { installed: true, bin, version, running: true, error: null };
}

function normalizeSnapshot(s: HerdrSnapshot): HerdrSnapshot {
  return {
    agents: s.agents ?? [], panes: s.panes ?? [], tabs: s.tabs ?? [], workspaces: s.workspaces ?? [],
    version: s.version, protocol: s.protocol,
    focused_pane_id: s.focused_pane_id, focused_workspace_id: s.focused_workspace_id,
  };
}

export async function herdrSnapshot(): Promise<HerdrResult<HerdrSnapshot>> {
  const r = await execHerdr<{ snapshot?: HerdrSnapshot }>(["api", "snapshot"], { timeoutMs: 3_000 });
  if (!r.ok) return { ok: false, data: null, raw: r.raw, error: r.error };
  const s = r.data?.snapshot;
  if (!s) return { ok: false, data: null, raw: r.raw, error: "Herdr answered without a session snapshot." };
  return { ok: true, error: null, raw: r.raw, data: normalizeSnapshot(s) };
}

// ------------------------------------------------- daemon snapshot cache read

export type HerdrSnapshotSource = "daemon-cache" | "legacy-spawn";

export interface HerdrSnapshotRead {
  snap: HerdrResult<HerdrSnapshot>;
  /** Daemon-reported status when the cache path answered; null on the legacy path. */
  status: HerdrStatus | null;
  generatedAt: string | null;
  stale: boolean | null;
  source: HerdrSnapshotSource;
}

// One warn per 60s so polling UIs don't spam when the daemon is down.
let lastDaemonSnapshotWarnAt = 0;

/**
 * Flag-gated snapshot read (SEN_GO_HERDR_SNAPSHOT_CACHE=1). Flag off runs the
 * untouched legacy spawn path. Flag on reads the sen-daemon snapshot cache; ANY
 * failure (unreachable, timeout, non-2xx, invalid shape) falls back to the
 * legacy spawn. A daemon 200 with snapshot:null is authoritative — herdr itself
 * is down and the legacy path would agree.
 */
export async function herdrSnapshotRead(): Promise<HerdrSnapshotRead> {
  if (process.env.SEN_GO_HERDR_SNAPSHOT_CACHE !== "1") {
    return { snap: await herdrSnapshot(), status: null, generatedAt: null, stale: null, source: "legacy-spawn" };
  }
  try {
    const r = await readDaemonHerdrSnapshot();
    const status: HerdrStatus = {
      installed: r.status.installed,
      bin: r.status.bin ?? null,
      version: r.status.version ?? null,
      running: r.status.running,
      error: r.status.error ?? null,
    };
    const cache = { generatedAt: r.cache.generated_at, stale: r.cache.stale, source: "daemon-cache" as const };
    const s = r.snapshot as HerdrSnapshot | null;
    if (!s) {
      return {
        snap: { ok: false, data: null, raw: "", error: status.error ?? "Herdr server is not running." },
        status, ...cache,
      };
    }
    return {
      snap: { ok: true, error: null, raw: JSON.stringify(s), data: normalizeSnapshot(s) },
      status, ...cache,
    };
  } catch (error) {
    const now = Date.now();
    if (now - lastDaemonSnapshotWarnAt > 60_000) {
      lastDaemonSnapshotWarnAt = now;
      console.warn(`[herdr] daemon snapshot cache unavailable, falling back to CLI spawn: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { snap: await herdrSnapshot(), status: null, generatedAt: null, stale: null, source: "legacy-spawn" };
  }
}

// -------------------------------------------------------------------- actions

export interface LaunchOptions {
  /** The command to run in the new pane, already resolved from a Builder. */
  bin: string;
  args?: readonly string[];
  /** Label Herdr shows for the agent. */
  label: string;
  cwd?: string;
  env?: Record<string, string>;
  workspaceId?: string;
  split?: "right" | "down";
}

/**
 * Start a Builder as an agent in a Herdr pane.
 *
 * `--env` is what makes this worth doing: the profile's isolation variable goes
 * straight into the pane, so a second Claude account runs in its own terminal
 * with its own login, side by side with the first.
 */
export async function launchAgent(opts: LaunchOptions): Promise<HerdrResult<unknown>> {
  const args = ["agent", "start", opts.label];
  if (opts.cwd) args.push("--cwd", opts.cwd);
  if (opts.workspaceId) args.push("--workspace", opts.workspaceId);
  if (opts.split) args.push("--split", opts.split);
  for (const [k, v] of Object.entries(opts.env ?? {})) args.push("--env", `${k}=${v}`);
  args.push("--focus", "--", opts.bin, ...(opts.args ?? []));
  return execHerdr(args, { timeoutMs: 20_000 });
}

export async function sendToAgent(target: string, text: string): Promise<HerdrResult<unknown>> {
  // `pane run` sends the text and presses Enter; `agent send` writes literal text.
  // A prompt is meant to be submitted, so this uses the pane form.
  return execHerdr(["pane", "run", target, text], { timeoutMs: 15_000 });
}

export async function readPane(paneId: string, lines = 40): Promise<HerdrResult<string>> {
  return execHerdrText(["pane", "read", paneId, "--lines", String(lines)], { timeoutMs: 12_000 });
}

export async function closePane(paneId: string): Promise<HerdrResult<unknown>> {
  return execHerdr(["pane", "close", paneId], { timeoutMs: 12_000 });
}

export async function createWorkspace(label: string, cwd?: string): Promise<HerdrResult<unknown>> {
  const args = ["workspace", "create", "--label", label];
  if (cwd) args.push("--cwd", cwd);
  return execHerdr(args, { timeoutMs: 15_000 });
}
