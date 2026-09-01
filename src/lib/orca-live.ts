/**
 * Live Orca structure for the orchestration dashboard (server-only).
 *
 * Shells out to the Orca CLI and projects the result into the page model:
 * every child worktree is one lane; every tab of that child (terminal tab or
 * browser tab) is one sub-lane. The task shown on a sub-lane is the task
 * currently dispatched to that tab's terminal, resolved via
 * `orchestration worker-list` (terminal handle -> dispatch -> taskId) plus a
 * per-run `orchestration task-list` for titles.
 *
 * All CLI calls are read-only and time-boxed; failures degrade to a
 * `degraded` note on the board instead of failing the whole response.
 */

import { execFile } from "node:child_process";

const CLI_TIMEOUT_MS = 15_000;
/** Short server-side cache so page polling does not spam the Orca daemon. */
const CACHE_TTL_MS = 10_000;

export interface LiveTask {
  id: string;
  title: string;
  status: string;
  runId: string;
}

export interface LiveSubLane {
  kind: "terminal" | "browser";
  /** Terminal handle or browser page id. */
  id: string;
  title: string;
  /** Terminal connected / browser tab active. */
  active: boolean;
  /** Terminal output tail / browser URL — the tab card's italic memo line. */
  memo?: string;
  /** This tab's terminal is the bound coordinator of the latest Orca run. */
  coordinator?: boolean;
  /** The lane's main running tab — pinned first and sticky on the row. */
  main?: boolean;
  task?: LiveTask;
}

export interface LiveLane {
  worktreeId: string;
  name: string;
  branch: string;
  path: string;
  isMain: boolean;
  comment?: string;
  /** Old-style card status: WORKING (live dispatch), ACTIVE (tabs open), IDLE. */
  status: "WORKING" | "ACTIVE" | "IDLE";
  /** Dispatch counters across the child's tabs: latest dispatch per terminal. */
  counters: { done: number; active: number; pending: number };
  /** Orca-side last activity timestamp (ms epoch), for the last-write line. */
  activityAt?: number;
  subLanes: LiveSubLane[];
}

export interface LiveScope {
  id: string;
  label: string;
}

/** One Orca project group (sidebar "Project") with its repos as scopes. */
export interface LiveScopeGroup {
  id: string;
  label: string;
  repos: LiveScope[];
}

export interface OrcaLiveBoard {
  scope: string | null;
  scopes: LiveScope[];
  groups: LiveScopeGroup[];
  /** The scope's primary (master) worktree — the parent the lanes belong to.
   *  Master has tabs too; they render inside the MASTER card. */
  primary: { name: string; branch: string; subLanes: LiveSubLane[] } | null;
  lanes: LiveLane[];
  generatedAt: string;
  /** Human-readable notes for CLI calls that failed (partial data served). */
  degraded: string[];
}

interface OrcaWorktree {
  id: string;
  repoId: string;
  path: string;
  branch: string;
  isMainWorktree: boolean;
  displayName: string;
  comment?: string | null;
  lastActivityAt?: number;
  /** Set when this worktree was created as a child of another worktree. */
  parentWorktreeId?: string | null;
}

interface OrcaTerminal {
  handle: string;
  worktreeId: string;
  tabId?: string;
  title: string;
  connected: boolean;
  preview?: string | null;
  lastOutputAt?: string | null;
}

/** visualLayouts entry: Orca window tab titles, keyed by tabId. */
interface OrcaVisualLayout {
  worktreeId: string;
  root?: {
    tabs?: { tabId: string; title?: string }[];
    groups?: { tabs?: { tabId: string; title?: string }[] }[];
  };
}

interface OrcaBrowserTab {
  browserPageId: string;
  worktreeId: string;
  title: string;
  url?: string;
  active: boolean;
}

interface OrcaWorker {
  taskId: string;
  runId: string;
  workerState: string;
  dispatchStatus: string;
  agentTerminalHandle: string;
}

interface OrcaRun {
  id: string;
  legacy: number;
  updated_at: string;
  coordinator_handle?: string | null;
}

interface OrcaTask {
  id: string;
  task_title?: string;
  display_name?: string;
}

interface OrcaRepo {
  id: string;
  displayName: string;
  path: string;
  projectGroupId?: string | null;
  projectGroupOrder?: number;
}

/**
 * Orca CLI exposes projectGroupId on repos but no group names; the sidebar
 * labels a group by the folder holding its repos ("Agent OS", ".tmp"), so we
 * derive the label from the longest common parent path of the member repos.
 */
function groupLabel(paths: string[]): string {
  if (paths.length === 0) return "project";
  const split = paths.map((p) => p.split("/").filter(Boolean));
  let depth = 0;
  while (split.every((parts) => parts[depth] !== undefined && parts[depth] === split[0][depth])) {
    depth += 1;
  }
  // Single-repo group: the repo sits one level under its group folder.
  const label =
    depth > 0 && split.length > 1 ? split[0][depth - 1] : split[0][Math.max(0, depth - 2)];
  return label ?? "project";
}

function runOrcaCli<T>(args: string[]): Promise<T> {
  return new Promise((resolve, reject) => {
    // Minimal clean environment: the dashboard may be launched through
    // wrapper chains (bash -> powershell -> cmd) whose inherited env block is
    // malformed for .NET children — orca.exe then dies with 0xC0000142
    // (STATUS_DLL_INIT_FAILED) before printing anything.
    const keep = [
      "PATH", "SystemRoot", "SystemDrive", "windir", "ComSpec",
      "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "HOME", "APPDATA", "LOCALAPPDATA",
      "PROGRAMDATA", "ProgramFiles", "ProgramFiles(x86)", "TEMP", "TMP",
      "NODE_ENV", "ORCA_PAIRING_CODE", "ORCA_ENVIRONMENT",
    ];
    const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV };
    for (const key of keep) {
      if (key === "NODE_ENV") continue;
      if (process.env[key] !== undefined) env[key] = process.env[key];
    }
    // shell: true — the `orca` shim is a script on Windows, not an .exe.
    execFile(
      "orca",
      args,
      { shell: true, timeout: CLI_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, env },
      (error, stdout, stderr) => {
        if (error) {
          const detail = stderr?.trim().slice(0, 200);
          const meta = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string };
          const tag = `code=${meta.code ?? "?"} killed=${meta.killed ?? false} signal=${meta.signal ?? "-"}`;
          return reject(
            new Error(detail ? `${error.message} — ${detail} [${tag}]` : `${error.message} [${tag}]`),
          );
        }
        const start = stdout.indexOf("{");
        if (start === -1) return reject(new Error("orca CLI returned no JSON"));
        try {
          const envelope = JSON.parse(stdout.slice(start)) as {
            ok?: boolean;
            result?: T;
            error?: { message?: string };
          };
          if (envelope.ok === false) {
            return reject(new Error(envelope.error?.message ?? "orca CLI error"));
          }
          resolve((envelope.result ?? envelope) as T);
        } catch (parseError) {
          reject(parseError);
        }
      },
    );
  });
}

async function collect<T>(
  label: string,
  degraded: string[],
  fallback: T,
  call: () => Promise<T>,
): Promise<T> {
  try {
    return await call();
  } catch (error) {
    degraded.push(`${label}: ${(error as Error).message}`);
    return fallback;
  }
}

/** Latest dispatch per terminal handle; later entries in worker-list win. */
function latestWorkerByTerminal(workers: OrcaWorker[]): Map<string, OrcaWorker> {
  const map = new Map<string, OrcaWorker>();
  for (const w of workers) {
    if (w.agentTerminalHandle) map.set(w.agentTerminalHandle, w);
  }
  return map;
}

let cache: { key: string; at: number; board: OrcaLiveBoard } | null = null;

export async function deriveOrcaLiveBoard(
  requestedScope?: string | null,
): Promise<OrcaLiveBoard> {
  const cacheKey = requestedScope ?? "";
  if (cache && cache.key === cacheKey && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.board;
  }

  const degraded: string[] = [];
  const [worktrees, terminalData, browserTabs, workers, current, repos, runs] = await Promise.all([
    collect<OrcaWorktree[]>("worktrees", degraded, [], async () =>
      (await runOrcaCli<{ worktrees: OrcaWorktree[] }>(["worktree", "list", "--json"])).worktrees),
    collect<{ terminals: OrcaTerminal[]; visualLayouts?: OrcaVisualLayout[] }>(
      "terminals",
      degraded,
      { terminals: [] },
      async () =>
        runOrcaCli<{ terminals: OrcaTerminal[]; visualLayouts?: OrcaVisualLayout[] }>([
          "terminal", "list", "--include-visual-layouts", "--json",
        ]),
    ),
    collect<OrcaBrowserTab[]>("browser tabs", degraded, [], async () =>
      (await runOrcaCli<{ tabs: OrcaBrowserTab[] }>(["tab", "list", "--json"])).tabs),
    collect<OrcaWorker[]>("workers", degraded, [], async () =>
      (await runOrcaCli<{ workers: OrcaWorker[] }>(["orchestration", "worker-list", "--json"])).workers),
    collect<OrcaWorktree | null>("current worktree", degraded, null, async () =>
      (await runOrcaCli<{ worktree: OrcaWorktree }>(["worktree", "current", "--json"])).worktree),
    collect<OrcaRepo[]>("repos", degraded, [], async () =>
      (await runOrcaCli<{ repos: OrcaRepo[] }>(["repo", "list", "--json"])).repos),
    collect<OrcaRun[]>("runs", degraded, [], async () =>
      (await runOrcaCli<{ runs: OrcaRun[] }>(["orchestration", "run-list", "--json"])).runs),
  ]);

  // The tab holding coordination authority: the bound coordinator terminal of
  // the most recently updated non-legacy run.
  const latestRun = runs
    .filter((r) => !r.legacy && r.coordinator_handle)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  const coordinatorHandle = latestRun?.coordinator_handle ?? null;

  const terminals = terminalData.terminals;
  // Orca window tab titles (what the tab bar shows), keyed by tabId. Terminal
  // `title` is only the process name; the tab title is the real label.
  const tabTitles = new Map<string, string>();
  for (const layout of terminalData.visualLayouts ?? []) {
    for (const group of [layout.root, ...(layout.root?.groups ?? [])]) {
      for (const tab of group?.tabs ?? []) {
        if (tab.title) tabTitles.set(tab.tabId, tab.title);
      }
    }
  }

  // Scopes mirror the Orca sidebar: Project groups (repo list projectGroupId)
  // containing their repos; each repo is one selectable scope. Repos the
  // worktree journal no longer knows are dropped.
  const repoIds = [...new Set(worktrees.map((w) => w.repoId))];
  const byGroup = new Map<string, OrcaRepo[]>();
  for (const repo of repos.filter((r) => repoIds.includes(r.id))) {
    const key = repo.projectGroupId ?? "ungrouped";
    byGroup.set(key, [...(byGroup.get(key) ?? []), repo]);
  }
  const groups: LiveScopeGroup[] = [...byGroup.entries()].map(([id, members]) => ({
    id,
    label: groupLabel(members.map((m) => m.path)),
    repos: members
      .sort((a, b) => (a.projectGroupOrder ?? 0) - (b.projectGroupOrder ?? 0))
      .map((m) => ({ id: m.id, label: m.displayName })),
  }));
  const scopes: LiveScope[] = groups.flatMap((g) => g.repos);
  // The dashboard's own repo is always offered even when Orca lists no repos.
  if (current && !scopes.some((s) => s.id === current.repoId)) {
    const fallback = { id: current.repoId, label: current.displayName };
    scopes.push(fallback);
    groups.push({ id: "current", label: "current", repos: [fallback] });
  }

  // Default scope: the project of the worktree serving this dashboard (the
  // master/primary project); fall back to the first scope.
  const defaultScope = current?.repoId ?? scopes[0]?.id ?? null;
  const scope =
    requestedScope && scopes.some((s) => s.id === requestedScope)
      ? requestedScope
      : defaultScope;

  // Task titles only for dispatches on terminals that are still live — the
  // worker journal keeps full history, and resolving every old run's tasks
  // would mean one CLI call per historical run for nothing.
  const liveHandles = new Set(terminals.map((t) => t.handle));
  const liveWorkers = workers.filter((w) => liveHandles.has(w.agentTerminalHandle));
  const byTerminal = latestWorkerByTerminal(liveWorkers);
  const runIds = [...new Set(liveWorkers.map((w) => w.runId).filter(Boolean))];
  const taskTitles = new Map<string, { title: string; runId: string }>();
  await Promise.all(
    runIds.map(async (runId) => {
      const tasks = await collect<OrcaTask[]>("task-list", degraded, [], async () =>
        (await runOrcaCli<{ tasks: OrcaTask[] }>([
          "orchestration", "task-list", "--run", runId, "--json",
        ])).tasks);
      for (const t of tasks) {
        taskTitles.set(t.id, {
          title: t.task_title ?? t.display_name ?? t.id,
          runId,
        });
      }
    }),
  );

  // Tabs of one worktree (terminal + browser) with the dispatch bound to each
  // terminal tab. Shared by children lanes and the primary (master has tabs
  // too — they render inside the MASTER card).
  const buildSubLanes = (worktreeId: string): LiveSubLane[] => {
    const subLanes: LiveSubLane[] = [];
    for (const t of terminals.filter((t) => t.worktreeId === worktreeId)) {
      const worker = byTerminal.get(t.handle);
      const taskInfo = worker ? taskTitles.get(worker.taskId) : undefined;
      subLanes.push({
        kind: "terminal",
        id: t.handle,
        title: (t.tabId && tabTitles.get(t.tabId)) ?? t.title,
        active: t.connected,
        // Terminal preview can be long multi-line output; last line is the
        // freshest and fits the two-line memo slot.
        memo: t.preview?.trim().split("\n").filter(Boolean).at(-1),
        coordinator: t.handle === coordinatorHandle || undefined,
        task: worker
          ? {
              id: worker.taskId,
              title: taskInfo?.title ?? worker.taskId,
              status: worker.dispatchStatus,
              runId: worker.runId,
            }
          : undefined,
      });
    }
    for (const b of browserTabs.filter((b) => b.worktreeId === worktreeId)) {
      subLanes.push({
        kind: "browser",
        id: b.browserPageId,
        title: b.title,
        active: b.active,
        memo: b.url,
      });
    }
    return subLanes;
  };

  // The lane's "main" tab: an in-flight dispatch wins (a worker is actually
  // running there); otherwise the connected terminal with the freshest
  // output. One per lane; pinned first on the row.
  const markMainTab = (subLanes: LiveSubLane[]): void => {
    const running = subLanes.find(
      (s) => s.task && (s.task.status === "running" || s.task.status === "ready"),
    );
    if (running) {
      running.main = true;
      return;
    }
    let freshest: LiveSubLane | undefined;
    let freshestAt = "";
    for (const s of subLanes) {
      if (s.kind !== "terminal" || !s.active) continue;
      const t = terminals.find((t) => t.handle === s.id);
      const at = t?.lastOutputAt ?? "";
      if (at > freshestAt) {
        freshestAt = at;
        freshest = s;
      }
    }
    if (freshest) freshest.main = true;
    // Pinned first; the row's sticky CSS keeps it in place while scrolling.
    subLanes.sort((a, b) => Number(b.main ?? false) - Number(a.main ?? false));
  };

  const scoped = worktrees.filter((w) => w.repoId === scope);
  // Lanes = the primary worktree's direct children, mirroring the sidebar's
  // "N children" group. The master/parent itself is not a lane; root-level
  // sibling worktrees (no parent) are not children either.
  const primary = scoped.find((w) => w.isMainWorktree);
  const lanes: LiveLane[] = scoped
    .filter((w) => w.parentWorktreeId && w.parentWorktreeId === primary?.id)
    .map((w) => {
      const subLanes = buildSubLanes(w.id);
      markMainTab(subLanes);
      // Old-card counters: latest dispatch per tab terminal. completed→done,
      // running/ready→active, anything else unfinished→pending.
      const counters = { done: 0, active: 0, pending: 0 };
      for (const sub of subLanes) {
        if (!sub.task) continue;
        if (sub.task.status === "completed") counters.done += 1;
        else if (sub.task.status === "running" || sub.task.status === "ready") counters.active += 1;
        else counters.pending += 1;
      }
      const status: LiveLane["status"] =
        counters.active > 0 ? "WORKING" : subLanes.length > 0 ? "ACTIVE" : "IDLE";
      return {
        worktreeId: w.id,
        name: w.displayName,
        branch: w.branch.replace(/^refs\/heads\//, ""),
        path: w.path,
        isMain: w.isMainWorktree,
        comment: w.comment ?? undefined,
        status,
        counters,
        activityAt: w.lastActivityAt,
        subLanes,
      };
    })
    // Master (primary) lane first, children after.
    .sort((a, b) => Number(b.isMain) - Number(a.isMain) || a.name.localeCompare(b.name));

  const board: OrcaLiveBoard = {
    scope,
    scopes,
    groups,
    primary: primary
      ? (() => {
          const subLanes = buildSubLanes(primary.id);
          // Master's main tab is the coordinator; fall back to the busiest.
          const coord = subLanes.find((s) => s.coordinator);
          if (coord) coord.main = true;
          else markMainTab(subLanes);
          subLanes.sort((a, b) => Number(b.main ?? false) - Number(a.main ?? false));
          return {
            name: primary.displayName,
            branch: primary.branch.replace(/^refs\/heads\//, ""),
            subLanes,
          };
        })()
      : null,
    lanes,
    generatedAt: new Date().toISOString(),
    degraded,
  };
  cache = { key: cacheKey, at: Date.now(), board };
  return board;
}
