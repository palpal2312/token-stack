// Sen home reader — the data layer for the /sen page.
//
// Sen's upstream home is the firstmate agent distro
// (https://github.com/kunchenguid/firstmate): a cloned repo whose private
// operational state lives in data/ (durable) and state/ (volatile) under the
// effective FM_HOME. This module reads those files directly — read-only — and
// pairs them with the live Herdr fleet filtered to the `firstmate` workspace,
// where this machine's crew panes live (legacy compatibility key; see the
// herdr-crew skill in the clone).
//
// Everything degrades to an honest empty state: a home that was cloned but
// never run has no state/, no backlog, no tasks — that is information, not an
// error.

import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { herdrStatus, herdrSnapshot, herdrSnapshotRead, type HerdrAgent, type HerdrWorkspace, type HerdrStatus } from "./herdr";
import { readWorkspacePlans, type WorkspacePlan, type PlanReport } from "./plansReader";

export type { WorkspacePlan, PlanReport };

export interface SenHome {
  home: string;
  found: boolean;
  /** "<short-hash> · <date>" from git log, null when unreadable. */
  version: string | null;
}

export interface SenTask {
  id: string;
  /** shell-style key=value fields from the .meta file (backend, window, …). */
  fields: Record<string, string>;
  mtime: number;
}

export interface BacklogSection { name: string; items: string[] }
export interface ScoutReport { id: string; title: string; mtime: number }

export interface SenFleet {
  status: HerdrStatus;
  workspace: HerdrWorkspace | null;
  agents: HerdrAgent[];
}

export interface SenOverview {
  home: SenHome;
  captain: string | null;
  backlog: BacklogSection[] | null;
  tasks: SenTask[];
  reports: ScoutReport[];
  plans: WorkspacePlan[];
  planReports: PlanReport[];
  plansRoots: string[];
  fleet: SenFleet;
  // Compatibility aliases for Go overview field-level shadow comparison
  // (goals|tasks|blockers|nextDecisions). Legacy firstmate tasks are not
  // canonical Goal/Task rows; empty arrays keep presence+type parity.
  goals: unknown[];
  blockers: string[];
  nextDecisions: string[];
}

// legacy compatibility key: upstream Herdr workspace label remains `firstmate`.
const FLEET_WORKSPACE_LABEL = "firstmate";

export function fmHome(): string {
  // legacy compatibility path: keep FM_HOME/default clone folder unchanged.
  return process.env.FM_HOME || path.join(os.homedir(), "firstmate");
}

// The version only changes on `git pull`/commit, so cache it per home for
// 60s — page loads (/api/sen, /api/sen/knowledge-files) must not each pay a
// git spawn. Same TTL as the herdrWorkers status cache.
const VERSION_CACHE_MS = 60_000;
let versionCache: { home: string; at: number; value: string | null } | null = null;

function gitHomeVersion(home: string): Promise<string | null> {
  if (versionCache && versionCache.home === home && Date.now() - versionCache.at < VERSION_CACHE_MS) {
    return Promise.resolve(versionCache.value);
  }
  return new Promise((resolve) => {
    execFile(
      "git", ["-C", home, "log", "-1", "--format=%h · %cs"],
      { timeout: 5_000, windowsHide: true },
      (err, stdout) => {
        const value = err ? null : stdout.trim() || null;
        versionCache = { home, at: Date.now(), value };
        resolve(value);
      },
    );
  });
}

export async function readHome(): Promise<SenHome> {
  const home = fmHome();
  try {
    await fs.access(path.join(home, "AGENTS.md"));
  } catch {
    return { home, found: false, version: null };
  }
  return { home, found: true, version: await gitHomeVersion(home) };
}

async function readTextOrNull(p: string, maxChars = 8_000): Promise<string | null> {
  try {
    const t = await fs.readFile(p, "utf8");
    return t.length > maxChars ? `${t.slice(0, maxChars)}\n…(truncated)` : t;
  } catch { return null; }
}

/**
 * data/backlog.md — tasks-axi markdown format: `## In flight` / `## Queued` /
 * `## Done` sections with `- ` items. Parsed loosely on purpose: the file is
 * owned by the upstream firstmate home, and a section we don't recognize is still shown by name.
 */
export async function readBacklog(home: string): Promise<BacklogSection[] | null> {
  const text = await readTextOrNull(path.join(home, "data", "backlog.md"), 40_000);
  if (text == null) return null;
  const sections: BacklogSection[] = [];
  let current: BacklogSection | null = null;
  for (const line of text.split(/\r?\n/)) {
    const h = line.match(/^##\s+(.+)/);
    if (h) { current = { name: h[1].trim(), items: [] }; sections.push(current); continue; }
    const item = line.match(/^\s*-\s+(.+)/);
    if (item && current) current.items.push(item[1].trim());
  }
  return sections;
}

/** state/<id>.meta — shell-style key=value records, one per task. */
export async function readTasks(home: string): Promise<SenTask[]> {
  const dir = path.join(home, "state");
  let files: string[];
  try { files = await fs.readdir(dir); } catch { return []; }
  const tasks: SenTask[] = [];
  for (const f of files.filter((x) => x.endsWith(".meta"))) {
    try {
      const raw = await fs.readFile(path.join(dir, f), "utf8");
      const fields: Record<string, string> = {};
      for (const line of raw.split(/\r?\n/)) {
        const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (m) fields[m[1]] = m[2].replace(/^"|"$/g, "");
      }
      const st = await fs.stat(path.join(dir, f));
      tasks.push({ id: f.replace(/\.meta$/, ""), fields, mtime: st.mtimeMs });
    } catch { /* a half-written meta is skipped, not fatal */ }
  }
  return tasks.sort((a, b) => b.mtime - a.mtime);
}

/** data/<id>/report.md — scout reports. Title = first heading, else first line. */
export async function readReports(home: string): Promise<ScoutReport[]> {
  const dataDir = path.join(home, "data");
  let entries: string[];
  try { entries = await fs.readdir(dataDir); } catch { return []; }
  const reports: ScoutReport[] = [];
  for (const e of entries) {
    const rp = path.join(dataDir, e, "report.md");
    try {
      const raw = await fs.readFile(rp, "utf8");
      const first = raw.split(/\r?\n/).find((l) => l.trim()) ?? "";
      const st = await fs.stat(rp);
      reports.push({ id: e, title: first.replace(/^#+\s*/, "").trim().slice(0, 120) || e, mtime: st.mtimeMs });
    } catch { /* not a report dir */ }
  }
  return reports.sort((a, b) => b.mtime - a.mtime);
}

/** The live fleet: Herdr snapshot filtered to the legacy `firstmate` workspace. */
export async function readFleet(): Promise<SenFleet> {
  // Flag-on path (SEN_GO_HERDR_SNAPSHOT_CACHE=1): one daemon-cache read instead
  // of the status+snapshot double spawn. Flag off is the legacy path, untouched.
  if (process.env.SEN_GO_HERDR_SNAPSHOT_CACHE === "1") {
    const read = await herdrSnapshotRead();
    const status = read.status ?? (await herdrStatus());
    if (!status.running) return { status, workspace: null, agents: [] };
    const snap = read.snap;
    if (!snap.ok || !snap.data) return { status, workspace: null, agents: [] };
    const workspace = snap.data.workspaces.find((w) => w.label === FLEET_WORKSPACE_LABEL) ?? null;
    const agents = workspace
      ? snap.data.panes.filter((p) => p.workspace_id === workspace.workspace_id)
      : [];
    return { status, workspace, agents };
  }
  const status = await herdrStatus();
  if (!status.running) return { status, workspace: null, agents: [] };
  const snap = await herdrSnapshot();
  if (!snap.ok || !snap.data) return { status, workspace: null, agents: [] };
  const workspace = snap.data.workspaces.find((w) => w.label === FLEET_WORKSPACE_LABEL) ?? null;
  const agents = workspace
    ? snap.data.panes.filter((p) => p.workspace_id === workspace.workspace_id)
    : [];
  return { status, workspace, agents };
}

export async function senOverview(): Promise<SenOverview> {
  const home = await readHome();
  const [captain, backlog, tasks, reports, fleet, workspacePlans] = await Promise.all([
    home.found ? readTextOrNull(path.join(home.home, "data", "captain.md")) : null,
    home.found ? readBacklog(home.home) : null,
    home.found ? readTasks(home.home) : [],
    home.found ? readReports(home.home) : [],
    readFleet(),
    readWorkspacePlans(),
  ]);
  return {
    home,
    captain,
    backlog,
    tasks,
    reports,
    plans: workspacePlans.plans,
    planReports: workspacePlans.planReports,
    plansRoots: workspacePlans.roots,
    fleet,
    goals: [],
    blockers: [],
    nextDecisions: [],
  };
}
