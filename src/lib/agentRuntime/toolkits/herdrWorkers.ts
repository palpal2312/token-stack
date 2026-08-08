// The Herdr worker toolkit: builders as PERSISTENT workers in terminal panes.
//
// delegate_task spawns a worker that answers once and dies. A pane worker is
// the opposite shape: Herdr owns the process, so the worker outlives the
// orchestrator's turn — Sen can start it, send follow-ups, read its screen,
// and close it when the job is done. The multiplexer is what makes the
// worker durable; this toolkit is only a thin, safety-railed layer over
// lib/herdr.ts.
//
// Three guardrails are structural, not prompt-level:
//
//   * The per-run registry. Every pane this toolkit starts is recorded under
//     the run's id, and ask/close only act on panes THIS run started. Herdr
//     holds the user's own live session — a worker toolkit that could type
//     into or close the user's panes would be a incident waiting for a
//     hallucinated pane id. Asking a pane that exists but belongs to someone
//     else comes back as a plain "not yours" error.
//   * start/ask/close are riskLevel "external" with requiresApproval forced
//     on: spawning spends real quota on a real account, and closing destroys
//     a process, so under the Sen gate a human sees each first ask in the
//     inbox.
//   * Herdr is optional. When the server is down every tool returns the same
//     explained { error } — the run routes around it instead of dying.
//
// Launch note: this does NOT use lib/herdr.ts's launchAgent. Herdr 0.7.5
// replaced `agent start`'s pane-creating flags (--cwd/--env/--split) with a
// facade that starts a known agent kind in an EXISTING pane — which neither
// fits arbitrary Builder bins nor the fixture CLI. The launch here is the
// version-correct equivalent built from the stable wrappers: `tab create`
// (carries cwd + the profile's isolation env into the pane) followed by a
// shell-quoted `pane run` of the Builder's own bin. The isolation env is the
// point — a second account stays a second account.

import {
  execHerdr, herdrSnapshot, herdrStatus, sendToAgent, readPane, closePane,
  type HerdrResult, type HerdrSnapshot, type HerdrStatus,
} from "../../herdr";
import { getBuilder } from "../../builders/registry";
import { defaultBuilderFor, resolveBuilderSpawn, BuilderSpawnError } from "../../builders/spawn";
import type { RuntimeTool, ToolContext } from "../agent";

// ------------------------------------------------------------ status cache

const STATUS_CACHE_MS = 60_000;
/** Cap on the wiring-time probe so a dead Herdr server never stalls a build. */
const STATUS_PROBE_CAP_MS = 6_000;

let statusCache: { at: number; value: HerdrStatus } | null = null;

/**
 * herdrStatus behind a 60s cache, for the preset's build-time wiring and the
 * toolkit's per-call guard alike. The first probe after the TTL is also
 * time-capped: when Herdr is installed but its server is down, the liveness
 * snapshot waits out its own timeout (~12s), and an Sen build must not
 * park on that. A capped probe reports "not running"; the real result still
 * lands in the cache when it resolves, so the next build sees the truth.
 */
export function cachedHerdrStatus(): Promise<HerdrStatus> {
  const now = Date.now();
  if (statusCache && now - statusCache.at < STATUS_CACHE_MS) return Promise.resolve(statusCache.value);
  const probe = herdrStatus().then((value) => {
    statusCache = { at: Date.now(), value };
    return value;
  });
  const cap = new Promise<HerdrStatus>((resolve) => setTimeout(() => resolve({
    installed: true, bin: null, version: null, running: false,
    error: "Probing Herdr took too long — its server may be down. Pane workers are disabled for this run.",
  }), STATUS_PROBE_CAP_MS));
  return Promise.race([probe, cap]);
}

// ------------------------------------------------------------------ deps

/** Everything the toolkit asks of Herdr, in one injectable seam for QA. */
export interface HerdrWorkerDeps {
  status(): Promise<HerdrStatus>;
  snapshot(): Promise<HerdrResult<HerdrSnapshot>>;
  launch(opts: {
    bin: string;
    args: readonly string[];
    label: string;
    cwd?: string;
    env: Record<string, string>;
  }): Promise<HerdrResult<{ paneId: string; tabId?: string }>>;
  send(paneId: string, text: string): Promise<HerdrResult<unknown>>;
  read(paneId: string, lines: number): Promise<HerdrResult<string>>;
  close(paneId: string): Promise<HerdrResult<unknown>>;
}

type PaneShell = "powershell" | "posix";

/** The shell a fresh pane is running, read from its foreground process. */
async function paneShell(paneId: string): Promise<PaneShell> {
  const r = await execHerdr<{ process_info?: { foreground_processes?: { argv0?: string }[] } }>(
    ["pane", "process-info", "--pane", paneId], { timeoutMs: 8_000 });
  const argv0 = r.ok ? (r.data?.process_info?.foreground_processes?.[0]?.argv0 ?? "") : "";
  if (/powershell|pwsh/i.test(argv0)) return "powershell";
  if (argv0) return "posix";
  // Probe failed: on Windows a default Herdr pane is PowerShell.
  return process.platform === "win32" ? "powershell" : "posix";
}

/**
 * Turn bin + args into one typeable command line. Every part is double-quoted
 * (safe in PowerShell, cmd, and POSIX shells); PowerShell additionally needs
 * the `&` call operator or a leading quoted path is a string expression, not
 * a command. Args containing a double quote are refused — quoting them
 * differs per shell and a Builder's args never legitimately need one.
 */
function commandLineFor(bin: string, args: readonly string[], shell: PaneShell): { line: string } | { error: string } {
  const parts = [bin, ...args];
  if (parts.some((p) => p.includes('"') || p.includes("\n"))) {
    return { error: "This worker's command contains a quote or newline, which cannot be typed into a pane safely." };
  }
  const line = parts.map((p) => `"${p}"`).join(" ");
  return { line: shell === "powershell" ? `& ${line}` : line };
}

/** The live launch: a fresh tab (env + cwd baked in), then the command typed in. */
async function liveLaunch(opts: {
  bin: string; args: readonly string[]; label: string; cwd?: string; env: Record<string, string>;
}): Promise<HerdrResult<{ paneId: string; tabId?: string }>> {
  // Land the worker tab in the workspace the user is looking at.
  let workspaceId: string | undefined;
  const snap = await herdrSnapshot();
  if (snap.ok) workspaceId = snap.data?.focused_workspace_id;

  const args = ["tab", "create", "--label", opts.label, "--no-focus"];
  if (workspaceId) args.push("--workspace", workspaceId);
  if (opts.cwd) args.push("--cwd", opts.cwd);
  // The profile's isolation env goes into the pane itself, so the worker's CLI
  // starts under its own login — the same guarantee launchAgent's --env gave.
  for (const [k, v] of Object.entries(opts.env)) args.push("--env", `${k}=${v}`);

  const created = await execHerdr<{ root_pane?: { pane_id?: string }; tab?: { tab_id?: string } }>(
    args, { timeoutMs: 15_000 });
  if (!created.ok) return { ok: false, data: null, raw: created.raw, error: created.error };
  const paneId = created.data?.root_pane?.pane_id;
  if (!paneId) {
    return { ok: false, data: null, raw: created.raw, error: "Herdr created the tab but did not name its pane." };
  }

  const cmd = commandLineFor(opts.bin, opts.args, await paneShell(paneId));
  if ("error" in cmd) {
    await closePane(paneId);
    return { ok: false, data: null, raw: created.raw, error: cmd.error };
  }
  const started = await sendToAgent(paneId, cmd.line);
  if (!started.ok) {
    // Never leave an orphan tab behind a failed launch.
    await closePane(paneId);
    return { ok: false, data: null, raw: created.raw, error: `The worker pane opened but its command could not be sent: ${started.error}` };
  }
  return { ok: true, data: { paneId, tabId: created.data?.tab?.tab_id }, raw: created.raw, error: null };
}

function liveDeps(): HerdrWorkerDeps {
  return {
    status: cachedHerdrStatus,
    snapshot: herdrSnapshot,
    launch: liveLaunch,
    send: sendToAgent,
    read: readPane,
    close: closePane,
  };
}

// --------------------------------------------------------------- registry

export interface WorkerRecord {
  paneId: string;
  tabId?: string;
  label: string;
  builderId: string;
  builderName: string;
  startedAt: string;
}

/** runId → paneId → record. The whole close/ask safety model lives here. */
const registry = new Map<string, Map<string, WorkerRecord>>();

function runWorkers(runId: string): Map<string, WorkerRecord> {
  let m = registry.get(runId);
  if (!m) { m = new Map(); registry.set(runId, m); }
  return m;
}

function runIdTag(runId: string): string {
  return runId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6) || "run";
}

// ---------------------------------------------------------------- toolkit

export interface HerdrWorkerToolkitOptions {
  /** Working directory for workers when the call does not name one. */
  defaultCwd?: string;
  /** CLI whose default Builder profile start_worker uses when builder_id is omitted. */
  defaultCli?: string;
  /** QA injection: a fake Herdr layer. Defaults to the live CLI wrappers. */
  deps?: HerdrWorkerDeps;
}

/** The shared guard: null when Herdr is up, else the explained error string. */
async function herdrDown(deps: HerdrWorkerDeps): Promise<string | null> {
  try {
    const s = await deps.status();
    if (s.running) return null;
    return `Herdr is not running${s.error ? ` — ${s.error}` : "."} Pane workers need a live Herdr session; use delegate_task for one-shot work instead.`;
  } catch (e) {
    return `Herdr is not running — its status could not be probed (${String((e as Error)?.message ?? e)}). Pane workers need a live Herdr session.`;
  }
}

/**
 * Refusal for a pane this run does not own, distinguishing the two cases the
 * model must route between: the pane exists but belongs to someone else
 * ("not yours" — never retry), and the pane is simply gone (its worker may
 * have exited; read the run's list).
 */
async function notOurs(deps: HerdrWorkerDeps, paneId: string): Promise<string> {
  const snap = await deps.snapshot();
  const exists = snap.ok && (snap.data?.panes ?? []).some((p) => p.pane_id === paneId);
  return exists
    ? `Pane ${paneId} is not yours — this run did not start it, and other panes (the user's included) are off-limits. list_pane_workers shows the panes this run owns.`
    : `No pane ${paneId} in this run's workers${snap.ok ? " or anywhere in the Herdr session" : ""}. list_pane_workers shows what this run started.`;
}

export function herdrWorkerToolkit(opts: HerdrWorkerToolkitOptions = {}): RuntimeTool[] {
  const deps = opts.deps ?? liveDeps();

  return [
    {
      name: "start_worker",
      description:
        "Start a Builder profile as a PERSISTENT worker in a Herdr pane and return its pane id. "
        + "Unlike delegate_task (one-shot, dies with the answer), a pane worker keeps running "
        + "between your turns: ask_worker it follow-ups, read_worker its screen, and close_worker "
        + "it when the job is done. Use this for work that needs steering, iteration, or a long "
        + "watch. The worker runs the profile's own binary with its isolation env, so a second "
        + "account stays a second account. Spawning spends real quota, so a human approves each start.",
      schema: {
        type: "object",
        properties: {
          label: { type: "string", description: "Short purpose label, shown in Herdr (e.g. \"docs-writer\")." },
          builder_id: { type: "string", description: "The worker's Builder profile id, from list_workers. Omit to use the default CLI's default profile." },
          cwd: { type: "string", description: "Working directory for the worker. Defaults to the agent's workspace." },
        },
        required: ["label"],
      },
      metadata: { riskLevel: "external", requiresApproval: true },
      async execute(args, ctx) {
        try {
          const down = await herdrDown(deps);
          if (down) return { error: down };

          const a = args as Record<string, unknown>;
          const labelIn = typeof a?.label === "string" ? a.label.trim() : "";
          if (!labelIn) return { error: "Give label as a non-empty string — it names the worker's pane." };

          let builder = null;
          const builderId = typeof a?.builder_id === "string" ? a.builder_id.trim() : "";
          if (builderId) {
            builder = await getBuilder(builderId);
            if (!builder) return { error: `No Builder profile "${builderId}". Call list_workers to see the ids — do not guess.` };
          } else {
            const cli = opts.defaultCli ?? "claude";
            builder = await defaultBuilderFor(cli);
            if (!builder) {
              return { error: `No default Builder profile for ${cli}. Pass builder_id from list_workers, or set a default profile first.` };
            }
          }

          let spawn;
          try {
            spawn = resolveBuilderSpawn(builder);
          } catch (e) {
            if (e instanceof BuilderSpawnError) return { error: e.message };
            throw e;
          }

          const label = `fm-${runIdTag(ctx.runId)}-${labelIn}`.replace(/[^\w .-]/g, "").slice(0, 60);
          const cwd = typeof a?.cwd === "string" && a.cwd.trim() ? a.cwd : opts.defaultCwd;
          const res = await deps.launch({
            bin: spawn.binOverride!, args: spawn.argsPrefix ?? [], label, cwd, env: spawn.extraEnv,
          });
          if (!res.ok || !res.data) return { error: res.error ?? "Herdr refused the launch without a reason." };

          const record: WorkerRecord = {
            paneId: res.data.paneId, tabId: res.data.tabId, label,
            builderId: builder.id, builderName: builder.name, startedAt: new Date().toISOString(),
          };
          runWorkers(ctx.runId).set(record.paneId, record);
          return {
            paneId: record.paneId, label, builder: { id: builder.id, name: builder.name, cli: builder.cli },
            ...(spawn.warnings.length ? { warnings: spawn.warnings } : {}),
          };
        } catch (e) {
          return { error: `start_worker failed: ${String((e as Error)?.message ?? e)}` };
        }
      },
    },
    {
      name: "ask_worker",
      description:
        "Send a follow-up to a pane worker this run started (the text is typed into its pane and "
        + "submitted, like a human pressing Enter). Only panes from this run's start_worker calls "
        + "are accepted — asking a pane that exists but belongs to someone else comes back as "
        + "\"not yours\". The answer does not come back here; watch for it with read_worker.",
      schema: {
        type: "object",
        properties: {
          pane_id: { type: "string", description: "The worker's pane id, from start_worker or list_pane_workers." },
          text: { type: "string", description: "The follow-up, self-contained — the worker sees only its own pane." },
        },
        required: ["pane_id", "text"],
      },
      metadata: { riskLevel: "external", requiresApproval: true },
      async execute(args, ctx) {
        try {
          const down = await herdrDown(deps);
          if (down) return { error: down };

          const a = args as Record<string, unknown>;
          const paneId = typeof a?.pane_id === "string" ? a.pane_id.trim() : "";
          if (!paneId) return { error: "Give pane_id as a string, from start_worker or list_pane_workers." };
          const text = typeof a?.text === "string" ? a.text : "";
          if (!text.trim()) return { error: "Give text as a non-empty string — it is typed into the worker's pane." };

          if (!runWorkers(ctx.runId).has(paneId)) return { error: await notOurs(deps, paneId) };

          const res = await deps.send(paneId, text);
          if (!res.ok) return { error: res.error ?? `Herdr refused to send to pane ${paneId}.` };
          return { ok: true, paneId };
        } catch (e) {
          return { error: `ask_worker failed: ${String((e as Error)?.message ?? e)}` };
        }
      },
    },
    {
      name: "read_worker",
      description:
        "Read the last lines of a worker pane's screen — the way to see what a pane worker said or "
        + "is doing after ask_worker. Returns { paneId, output } or { error }.",
      schema: {
        type: "object",
        properties: {
          pane_id: { type: "string", description: "The worker's pane id, from start_worker or list_pane_workers." },
          lines: { type: "number", description: "How many screen lines to read back. Defaults to 40." },
        },
        required: ["pane_id"],
      },
      metadata: { riskLevel: "read" },
      async execute(args, ctx) {
        try {
          const down = await herdrDown(deps);
          if (down) return { error: down };

          const a = args as Record<string, unknown>;
          const paneId = typeof a?.pane_id === "string" ? a.pane_id.trim() : "";
          if (!paneId) return { error: "Give pane_id as a string, from start_worker or list_pane_workers." };
          const lines = typeof a?.lines === "number" && a.lines > 0 ? Math.min(Math.floor(a.lines), 200) : 40;

          const res = await deps.read(paneId, lines);
          if (!res.ok) return { error: res.error ?? `Herdr refused to read pane ${paneId}.` };
          return { paneId, output: res.data ?? "" };
        } catch (e) {
          return { error: `read_worker failed: ${String((e as Error)?.message ?? e)}` };
        }
      },
    },
    {
      name: "close_worker",
      description:
        "Close a pane worker this run started, killing the process in its pane. Only panes from "
        + "this run's start_worker calls can be closed — the user's own panes are refused by "
        + "construction. Always close workers when their job is done, unless the user asked to "
        + "keep one running.",
      schema: {
        type: "object",
        properties: {
          pane_id: { type: "string", description: "The worker's pane id, from start_worker or list_pane_workers." },
        },
        required: ["pane_id"],
      },
      metadata: { riskLevel: "external", requiresApproval: true },
      async execute(args, ctx) {
        try {
          const down = await herdrDown(deps);
          if (down) return { error: down };

          const a = args as Record<string, unknown>;
          const paneId = typeof a?.pane_id === "string" ? a.pane_id.trim() : "";
          if (!paneId) return { error: "Give pane_id as a string, from start_worker or list_pane_workers." };

          const workers = runWorkers(ctx.runId);
          if (!workers.has(paneId)) return { error: await notOurs(deps, paneId) };

          const res = await deps.close(paneId);
          if (!res.ok) return { error: res.error ?? `Herdr refused to close pane ${paneId}.` };
          workers.delete(paneId);
          return { ok: true, closed: paneId };
        } catch (e) {
          return { error: `close_worker failed: ${String((e as Error)?.message ?? e)}` };
        }
      },
    },
    {
      name: "list_pane_workers",
      description:
        "List the pane workers THIS run started (never other runs' or the user's panes), each with "
        + "its pane id, label, builder, start time, and — when Herdr's snapshot has it — whether "
        + "the pane is still alive and its agent status (idle/working/blocked).",
      schema: { type: "object", properties: {} },
      metadata: { riskLevel: "read" },
      async execute(_args, ctx) {
        try {
          const down = await herdrDown(deps);
          if (down) return { error: down };

          const workers = [...runWorkers(ctx.runId).values()];
          const snap = await deps.snapshot();
          const panes = snap.ok ? (snap.data?.panes ?? []) : [];
          return {
            workers: workers.map((w) => {
              const live = panes.find((p) => p.pane_id === w.paneId);
              return {
                ...w,
                alive: Boolean(live),
                ...(live?.agent_status ? { agentStatus: live.agent_status } : {}),
                ...(live?.agent ? { agent: live.agent } : {}),
              };
            }),
          };
        } catch (e) {
          return { error: `list_pane_workers failed: ${String((e as Error)?.message ?? e)}` };
        }
      },
    },
  ];
}
