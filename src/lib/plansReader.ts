import { promises as fs } from "node:fs";
import path from "node:path";

export interface WorkspacePlan {
  slug: string;
  title: string;
  status: string | null;
  mtime: number;
  /** Absolute path to plan.md */
  planPath: string;
  /** Which scanned root this plan came from (for display). */
  rootLabel: string;
}

export interface PlanReport {
  id: string;
  planSlug: string;
  title: string;
  mtime: number;
  reportPath: string;
}

export interface WorkspacePlansPayload {
  roots: string[];
  plans: WorkspacePlan[];
  planReports: PlanReport[];
}

/** Candidate plan folders — repo `plans/`, `source/plans/`, optional PLANS_DIR. */
export function workspacePlansDirs(): string[] {
  const dirs = new Set<string>();
  const env = process.env.PLANS_DIR || process.env.AGENT_OS_PLANS;
  if (env) dirs.add(path.resolve(env));
  const cwd = process.cwd();
  dirs.add(path.resolve(cwd, "..", "plans"));
  dirs.add(path.resolve(cwd, "plans"));
  return [...dirs];
}

function rootLabel(root: string, cwd: string): string {
  const rel = path.relative(path.resolve(cwd, ".."), root);
  if (!rel || rel === ".") return "plans";
  return rel.replace(/\\/g, "/");
}

function parsePlanTitle(raw: string, fallback: string): string {
  const fm = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  const body = fm ? raw.slice(fm[0].length) : raw;
  const fmTitle = raw.match(/^title:\s*["']?([^"'\n]+)["']?/m)?.[1]?.trim();
  if (fmTitle) return fmTitle.slice(0, 160);
  const heading = body.split(/\r?\n/).find((l) => /^#\s+/.test(l));
  if (heading) return heading.replace(/^#+\s*/, "").trim().slice(0, 160);
  return fallback;
}

function parsePlanStatus(raw: string): string | null {
  return raw.match(/^status:\s*(\S+)/m)?.[1]?.trim() ?? null;
}

async function dirExists(p: string): Promise<boolean> {
  try {
    const st = await fs.stat(p);
    return st.isDirectory();
  } catch {
    return false;
  }
}

async function scanPlanRoot(root: string, label: string, seen: Set<string>): Promise<{ plans: WorkspacePlan[]; planReports: PlanReport[] }> {
  const plans: WorkspacePlan[] = [];
  const planReports: PlanReport[] = [];
  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch {
    return { plans, planReports };
  }

  for (const entry of entries) {
    const dir = path.join(root, entry);
    let st;
    try {
      st = await fs.stat(dir);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;

    const planFile = path.join(dir, "plan.md");
    try {
      const raw = await fs.readFile(planFile, "utf8");
      const pst = await fs.stat(planFile);
      const key = `${label}/${entry}`;
      if (!seen.has(key)) {
        seen.add(key);
        plans.push({
          slug: entry,
          title: parsePlanTitle(raw, entry),
          status: parsePlanStatus(raw),
          mtime: pst.mtimeMs,
          planPath: planFile,
          rootLabel: label,
        });
      }
    } catch {
      /* not a plan folder */
    }

    const reportsDir = path.join(dir, "reports");
    try {
      const reportFiles = await fs.readdir(reportsDir);
      for (const rf of reportFiles.filter((f) => f.endsWith(".md"))) {
        const rp = path.join(reportsDir, rf);
        try {
          const raw = await fs.readFile(rp, "utf8");
          const rst = await fs.stat(rp);
          const first = raw.split(/\r?\n/).find((l) => l.trim()) ?? "";
          planReports.push({
            id: `${entry}/${rf.replace(/\.md$/, "")}`,
            planSlug: entry,
            title: first.replace(/^#+\s*/, "").trim().slice(0, 120) || rf,
            mtime: rst.mtimeMs,
            reportPath: rp,
          });
        } catch { /* skip */ }
      }
    } catch { /* no reports dir */ }
  }

  return { plans, planReports };
}

export async function readWorkspacePlans(): Promise<WorkspacePlansPayload> {
  const cwd = process.cwd();
  const roots: string[] = [];
  const plans: WorkspacePlan[] = [];
  const planReports: PlanReport[] = [];
  const seen = new Set<string>();

  for (const root of workspacePlansDirs()) {
    if (!(await dirExists(root))) continue;
    roots.push(root);
    const label = rootLabel(root, cwd);
    const batch = await scanPlanRoot(root, label, seen);
    plans.push(...batch.plans);
    planReports.push(...batch.planReports);
  }

  plans.sort((a, b) => b.mtime - a.mtime);
  planReports.sort((a, b) => b.mtime - a.mtime);
  return { roots, plans, planReports };
}
