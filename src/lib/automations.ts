// Automations: scheduled, unattended Sen runs with transcripts.
//
// Two brain kinds, two execution paths:
//   * router — the Phase 3 runtime runner (run/resume, policies, run-state
//     files, transcript.md per run). With requiresApproval on (the default),
//     a gated tool call parks the run and lands in the approvals inbox
//     instead of executing; the run finishes when a human answers.
//   * builder — a one-shot CLI turn through the same runBuilderChat the Arena
//     and agent chats use, so the QA fixture CLI works here unchanged.
//
// The scheduler is dashboard-resident v1, by deliberate constraint: it ticks
// only while this Next.js server is up, and says so in the UI. The semantics
// are taken from openworker (docs/openworker-aisuite-capability-map.md §1.1):
//   * catch-up-once — after downtime, a missed automation fires once, not
//     once per missed slot;
//   * skip-on-overlap — a run still in flight is never started twice, the
//     firing is recorded as skipped;
//   * session-per-run — every run is a full runtime run (or builder turn)
//     with its own transcript on disk.
// Unattended spend is capped by MAX_RUNS_PER_DAY below — a code constant, not
// a setting, so no config mistake can raise it. Manual "run now" counts
// toward the same cap: the cap exists to bound spend, and a hand that clicks
// seven times is still spend.
//
// Storage follows the house rules: ~/.agentic-os/automations.json written
// serialized + tmp/rename atomic, corruption reported never repaired. Run
// records are one JSON per run under ~/.agentic-os/automations/runs/.

import { readFile, writeFile, rename, mkdir, unlink, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { AGENTIC_HOME, RegistryCorrupt, slugify } from "./builders/registry";
import { getBuilder } from "./builders/registry";
import { runBuilderChat } from "./builders/chat";
import { getRouter } from "./routers/registry";
import { run, resume, type RunResult } from "./agentRuntime/runner";
import { FileStateStore, type RunState, type RunStep } from "./agentRuntime/state";
import { AllowAll, RequireApprovalPolicy, type ToolPolicy } from "./agentRuntime/policies";
import { filesToolkit } from "./agentRuntime/toolkits/files";
import { shellToolkit } from "./agentRuntime/toolkits/shell";
import type { Agent } from "./agentRuntime/agent";
import { parkApproval, decideApproval, summarizeCall, type ApprovalItem } from "./approvals";
import { buildAukerAgent } from "./agentRuntime/presets/sen";
import { enabledMcpConfigs } from "./mcpServers";
import { AssetRepository } from "./llmops/assets";

/** Hard ceiling on unattended runs per automation per day. Code, not config. */
export const MAX_RUNS_PER_DAY = 6;
export const MIN_INTERVAL_MIN = 30;
export const MAX_INTERVAL_MIN = 1440;
const TICK_MS = 60_000;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export type AutomationBrainRef =
  | { kind: "router"; routerId: string }
  | { kind: "builder"; builderId: string }
  // "firstmate" is the Sen brain — legacy compatibility key kept as the
  // persisted discriminator so existing saved automations keep loading.
  | { kind: "firstmate"; routerId: string };

export interface Automation {
  id: string;
  name: string;
  /** Every N minutes (30–1440). Exactly one of intervalMin / timeOfDay is set. */
  intervalMin?: number;
  /** Local wall-clock "HH:mm", fires once a day. */
  timeOfDay?: string;
  brainRef: AutomationBrainRef;
  prompt: string;
  /** Router brains only: gate write/external tools into the approvals inbox. */
  requiresApproval: boolean;
  enabled: boolean;
  lastRunAt?: string;
  nextRunAt: string;
  /** Attempts today (failures count — they spent the attempt). */
  runsToday: number;
  /** Local YYYY-MM-DD the counter belongs to; a new day resets it. */
  runsTodayDate: string;
  /** Why the last due firing did not happen ("overlap" | "daily-cap"). */
  lastSkip?: { at: string; reason: string };
  createdAt: string;
  assetHash?: string;
}

export type AutomationTrigger = "schedule" | "manual";

export interface AutomationRun {
  /** For router brains this IS the runtime run id, so approve→resume finds it. */
  id: string;
  automationId: string;
  trigger: AutomationTrigger;
  startedAt: string;
  /** Runtime statuses ("done" | "blocked" | "failed" | "max-turns") or builder's done/failed. */
  status: string;
  output:
    | { kind: "runtime"; runDir: string; finalText: string }
    | { kind: "builder"; text: string; error: string | null };
  durationMs: number;
  assetVersion?: string;
}

interface AutomationsFile { version: 1; automations: Automation[] }

// Lazy home, same reason as lib/approvals.ts: QA redirects AGENTIC_OS_HOME
// after import time.
function home(): string { return process.env.AGENTIC_OS_HOME ?? AGENTIC_HOME; }
function automationsFile(): string { return path.join(home(), "automations.json"); }
function runsDir(): string { return path.join(home(), "automations", "runs"); }
/** Exported for run-closure (lib/closeRun.ts callers build their store here). */
export function runtimeRunsDir(): string { return path.join(home(), "runtime", "runs"); }
function workspaceDir(id: string): string { return path.join(home(), "automations", "workspace", id); }

// ---------------------------------------------------------------- persistence

let writeChain: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeChain.then(fn, fn);
  writeChain = next.then(() => undefined, () => undefined);
  return next;
}

function normalize(a: Partial<Automation>): Automation {
  return {
    id: String(a.id ?? ""),
    name: String(a.name ?? a.id ?? ""),
    intervalMin: typeof a.intervalMin === "number" ? a.intervalMin : undefined,
    timeOfDay: typeof a.timeOfDay === "string" ? a.timeOfDay : undefined,
    brainRef: a.brainRef as AutomationBrainRef,
    prompt: String(a.prompt ?? ""),
    requiresApproval: a.requiresApproval !== false,
    enabled: a.enabled !== false,
    lastRunAt: a.lastRunAt ? String(a.lastRunAt) : undefined,
    nextRunAt: String(a.nextRunAt ?? new Date().toISOString()),
    runsToday: Number(a.runsToday ?? 0),
    runsTodayDate: String(a.runsTodayDate ?? ""),
    lastSkip: a.lastSkip && typeof a.lastSkip.reason === "string"
      ? { at: String(a.lastSkip.at ?? ""), reason: a.lastSkip.reason }
      : undefined,
    createdAt: String(a.createdAt ?? new Date().toISOString()),
    assetHash: a.assetHash ? String(a.assetHash) : undefined,
  };
}

async function readFileRaw(): Promise<AutomationsFile | null> {
  const f = automationsFile();
  if (!existsSync(f)) return null;
  let text: string;
  try { text = await readFile(f, "utf8"); }
  catch (e) { throw new RegistryCorrupt(f, e); }
  if (!text.trim()) return { version: 1, automations: [] };
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch (e) { throw new RegistryCorrupt(f, e); }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as AutomationsFile).automations)) {
    throw new RegistryCorrupt(f, "no automations array");
  }
  return { version: 1, automations: (parsed as AutomationsFile).automations.map(normalize) };
}

async function writeAtomic(data: AutomationsFile): Promise<void> {
  const f = automationsFile();
  await mkdir(home(), { recursive: true });
  const tmp = `${f}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  try {
    await rename(tmp, f);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }
}

// ------------------------------------------------------------------ scheduling

function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The next fire time strictly after `from`, per the automation's schedule. */
export function computeNext(a: Pick<Automation, "intervalMin" | "timeOfDay">, from: Date): Date {
  if (a.intervalMin) return new Date(from.getTime() + a.intervalMin * 60_000);
  const [h, m] = String(a.timeOfDay).split(":").map(Number);
  const next = new Date(from);
  next.setHours(h, m, 0, 0);
  if (next.getTime() <= from.getTime()) next.setDate(next.getDate() + 1);
  return next;
}

/**
 * Where a capped automation waits: the day's first slot tomorrow. An interval
 * automation parks at midnight rather than re-skipping every interval until
 * the counter resets — same outcome, one skip record instead of dozens.
 */
function afterCap(a: Automation, now: Date): Date {
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  if (a.timeOfDay) {
    const [h, m] = a.timeOfDay.split(":").map(Number);
    tomorrow.setHours(h, m, 0, 0);
  }
  return tomorrow;
}

function resetDayIfNeeded(a: Automation, now: Date): void {
  const today = localDay(now);
  if (a.runsTodayDate !== today) {
    a.runsTodayDate = today;
    a.runsToday = 0;
  }
}

// ------------------------------------------------------------------ CRUD

export async function listAutomations(): Promise<Automation[]> {
  const f = await readFileRaw();
  return f?.automations ?? [];
}

export async function getAutomation(id: string): Promise<Automation | null> {
  return (await listAutomations()).find((a) => a.id === id) ?? null;
}

export interface CreateAutomationInput {
  name: string;
  intervalMin?: number;
  timeOfDay?: string;
  brainRef: AutomationBrainRef;
  prompt: string;
  requiresApproval?: boolean;
  enabled?: boolean;
}

function validateSchedule(input: { intervalMin?: number; timeOfDay?: string }): void {
  const hasInterval = input.intervalMin !== undefined && input.intervalMin !== null;
  const hasTime = Boolean(input.timeOfDay);
  if (hasInterval === hasTime) {
    throw new Error("Give the automation exactly one schedule: an interval in minutes, or a time of day.");
  }
  if (hasInterval) {
    const n = Number(input.intervalMin);
    if (!Number.isInteger(n) || n < MIN_INTERVAL_MIN || n > MAX_INTERVAL_MIN) {
      throw new Error(`The interval must be a whole number of minutes between ${MIN_INTERVAL_MIN} and ${MAX_INTERVAL_MIN}.`);
    }
  }
  if (hasTime && !TIME_OF_DAY.test(String(input.timeOfDay))) {
    throw new Error(`The time of day must look like "09:30" (24h, local), not "${input.timeOfDay}".`);
  }
}

async function validateBrainRef(ref: AutomationBrainRef): Promise<void> {
  if (ref?.kind === "router" || ref?.kind === "firstmate") {
    // Sen thinks through a Router too — the kind changes the persona
    // and toolbox, not the account it bills.
    if (!(await getRouter(String(ref.routerId ?? "")))) {
      throw new Error(`No Router "${ref.routerId}". Create one on the Routers page first.`);
    }
    return;
  }
  if (ref?.kind === "builder") {
    if (!(await getBuilder(String(ref.builderId ?? "")))) {
      throw new Error(`No Builder profile "${ref.builderId}".`);
    }
    return;
  }
  throw new Error("The brain must be a Router, Sen, or a Builder.");
}

export async function createAutomation(input: CreateAutomationInput): Promise<Automation> {
  const name = String(input.name ?? "").trim();
  if (!name) throw new Error("Give the automation a name.");
  const prompt = String(input.prompt ?? "").trim();
  if (!prompt) throw new Error("Give the automation a prompt — it is the whole job description.");
  validateSchedule(input);
  await validateBrainRef(input.brainRef);

  return serialized(async () => {
    const f = (await readFileRaw()) ?? { version: 1 as const, automations: [] };
    const base = slugify(name) || "automation";
    let id = base;
    for (let n = 2; f.automations.some((a) => a.id === id); n++) id = `${base}-${n}`;

    const now = new Date();
    const a = normalize({
      id, name, prompt,
      intervalMin: input.intervalMin,
      timeOfDay: input.timeOfDay,
      brainRef: input.brainRef,
      requiresApproval: input.requiresApproval !== false,
      enabled: input.enabled !== false,
      runsToday: 0,
      runsTodayDate: localDay(now),
      createdAt: now.toISOString(),
    });
    a.nextRunAt = computeNext(a, now).toISOString();
    f.automations.push(a);
    await writeAtomic(f);
    return a;
  });
}

export interface PatchAutomationInput {
  name?: string;
  prompt?: string;
  intervalMin?: number | null;
  timeOfDay?: string | null;
  requiresApproval?: boolean;
  enabled?: boolean;
}

export async function updateAutomation(id: string, patch: PatchAutomationInput): Promise<Automation> {
  return serialized(async () => {
    const f = await readFileRaw();
    const a = f?.automations.find((x) => x.id === id);
    if (!f || !a) throw new Error(`No automation "${id}".`);

    if (patch.name !== undefined) {
      const n = String(patch.name).trim();
      if (!n) throw new Error("The automation needs a name.");
      a.name = n;
    }
    if (patch.prompt !== undefined) {
      const p = String(patch.prompt).trim();
      if (!p) throw new Error("The prompt cannot be empty — it is the whole job description.");
      a.prompt = p;
    }

    let scheduleChanged = false;
    if (patch.intervalMin !== undefined) {
      a.intervalMin = patch.intervalMin === null ? undefined : patch.intervalMin;
      if (patch.intervalMin !== null) a.timeOfDay = undefined;
      scheduleChanged = true;
    }
    if (patch.timeOfDay !== undefined) {
      a.timeOfDay = patch.timeOfDay === null ? undefined : patch.timeOfDay;
      if (patch.timeOfDay !== null) a.intervalMin = undefined;
      scheduleChanged = true;
    }
    if (scheduleChanged) {
      validateSchedule(a);
      a.nextRunAt = computeNext(a, new Date()).toISOString();
    }
    if (patch.requiresApproval !== undefined) a.requiresApproval = Boolean(patch.requiresApproval);
    if (patch.enabled !== undefined) {
      a.enabled = Boolean(patch.enabled);
      // Re-enabling starts the schedule fresh from now. The alternative —
      // leaving an ancient nextRunAt — would fire an immediate catch-up for a
      // gap the user just said they wanted.
      if (a.enabled) a.nextRunAt = computeNext(a, new Date()).toISOString();
    }
    await writeAtomic(f);
    return a;
  });
}

export async function deleteAutomation(id: string): Promise<void> {
  return serialized(async () => {
    const f = await readFileRaw();
    if (!f?.automations.some((x) => x.id === id)) throw new Error(`No automation "${id}".`);
    f.automations = f.automations.filter((x) => x.id !== id);
    await writeAtomic(f);
  });
}

// ------------------------------------------------------------------ execution

export class CapReached extends Error {
  constructor(public readonly automation: Automation) {
    super(
      `"${automation.name}" has already run ${MAX_RUNS_PER_DAY} times today — the unattended-spend cap. `
      + `It runs again after midnight. (Manual runs count too: the cap bounds spend, not just the scheduler.)`,
    );
    this.name = "CapReached";
  }
}

export class AlreadyRunning extends Error {
  constructor(a: Automation) {
    super(`"${a.name}" is still running — wait for it to finish (skip-on-overlap).`);
    this.name = "AlreadyRunning";
  }
}

/**
 * Claim one run against the daily cap. This is the ONLY place runsToday moves,
 * inside the serialized write chain, so a tick and a manual click cannot both
 * take the sixth slot. Scheduled claims also advance nextRunAt past `now` —
 * that advance IS catch-up-once: however many slots were missed, exactly one
 * run is claimed and the schedule resumes from now.
 */
async function claimRun(id: string, now: Date, trigger: AutomationTrigger): Promise<Automation> {
  return serialized(async () => {
    const f = await readFileRaw();
    const a = f?.automations.find((x) => x.id === id);
    if (!f || !a) throw new Error(`No automation "${id}".`);
    resetDayIfNeeded(a, now);
    if (a.runsToday >= MAX_RUNS_PER_DAY) {
      a.lastSkip = { at: now.toISOString(), reason: `daily-cap: ${MAX_RUNS_PER_DAY} runs/day reached` };
      a.nextRunAt = afterCap(a, now).toISOString();
      await writeAtomic(f);
      throw new CapReached(a);
    }
    a.runsToday += 1;
    if (trigger === "schedule") a.nextRunAt = computeNext(a, now).toISOString();
    await writeAtomic(f);
    return a;
  });
}

async function recordSkip(id: string, now: Date, reason: string): Promise<void> {
  return serialized(async () => {
    const f = await readFileRaw();
    const a = f?.automations.find((x) => x.id === id);
    if (!f || !a) return;
    a.lastSkip = { at: now.toISOString(), reason };
    a.nextRunAt = computeNext(a, now).toISOString();
    await writeAtomic(f);
  });
}

async function setLastRun(id: string, at: string): Promise<void> {
  return serialized(async () => {
    const f = await readFileRaw();
    const a = f?.automations.find((x) => x.id === id);
    if (!f || !a) return;
    a.lastRunAt = at;
    await writeAtomic(f);
  });
}

function checkRunId(runId: string): void {
  if (!RUN_ID.test(runId)) throw new Error(`"${runId}" is not a run id.`);
}

/** Exported for run-closure: closeRun flips a blocked record to failed. */
export async function writeRunRecord(rec: AutomationRun): Promise<void> {
  checkRunId(rec.id);
  await mkdir(runsDir(), { recursive: true });
  const f = path.join(runsDir(), `${rec.id}.json`);
  const tmp = `${f}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  await writeFile(tmp, JSON.stringify(rec, null, 2) + "\n", "utf8");
  try {
    await rename(tmp, f);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }
}

export async function readRunRecord(runId: string): Promise<AutomationRun | null> {
  checkRunId(runId);
  const f = path.join(runsDir(), `${runId}.json`);
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(await readFile(f, "utf8")) as AutomationRun;
  } catch (e) {
    throw new RegistryCorrupt(f, e);
  }
}

/** The agent a router-brained automation runs as — built the same way at fire
 * time and at approve-resume time, so a parked run resumes as exactly itself. */
function agentFor(a: Automation, ws: string): Agent {
  if (a.brainRef.kind !== "router") throw new Error(`"${a.name}" is not router-brained.`);
  return {
    name: `automation:${a.name}`,
    instructions:
      `You are the scheduled automation "${a.name}", running unattended inside Agent OS. `
      + `Do the job the prompt describes, use the file and shell tools when they help `
      + `(they are jailed to ${ws}), and finish with a short report of what you did.`,
    tools: [...filesToolkit(ws), ...shellToolkit(ws)],
    brain: { kind: "router", routerId: a.brainRef.routerId },
  };
}

function policiesFor(a: Automation): ToolPolicy[] {
  if (!a.requiresApproval) return [AllowAll];
  // The handler cannot say yes on its own — nobody is at the keyboard — so it
  // always parks: the ask lands in the approvals store, the runner blocks, and
  // the Inbox's approve is what resumes it. That is the whole inbox loop.
  return [RequireApprovalPolicy(async (tool, ctx): Promise<"park"> => {
    await parkApproval({
      runId: ctx.runId,
      source: "automation",
      toolCallId: ctx.toolCallId,
      tool: tool.name,
      args: ctx.args,
      summary: summarizeCall(`automation:${a.name}`, tool.name, ctx.args),
    });
    return "park";
  })];
}

interface RuntimeAgentBuild { agent: Agent; policies: ToolPolicy[]; close(): Promise<void> }

/**
 * Agent + policies for one runtime-brained automation, built identically at
 * fire time and at approve-resume time. "router" keeps the plain unattended
 * agent above; "firstmate" (legacy compatibility key) runs the Sen preset
 * (deliverable-first persona, full toolkits, MCP connectors) with the same
 * park-into-inbox loop.
 */
async function runtimeAgentFor(a: Automation, ws: string): Promise<RuntimeAgentBuild> {
  if (a.brainRef.kind === "firstmate") {
    const fm = await buildAukerAgent({
      routerId: a.brainRef.routerId,
      workspace: ws,
      mcpServers: await enabledMcpConfigs(),
      approvalSource: "automation",
      approvalLabel: `automation:${a.name}`,
    });
    // requiresApproval=off means AllowAll even for Sen — the user's
    // stated choice wins over the preset's caution, as it does for routers.
    return { agent: fm.agent, policies: a.requiresApproval ? fm.policies : [AllowAll], close: fm.close };
  }
  return { agent: agentFor(a, ws), policies: policiesFor(a), close: async () => {} };
}

async function executeRuntime(a: Automation, trigger: AutomationTrigger, started: Date, runId: string): Promise<AutomationRun> {
  // One root per run, and everything lives under it: the toolkits' jail, the
  // deliverables, the state file's siblings. Jailing files/shell at a separate
  // per-automation workspace while deliverables landed in the run dir meant
  // the agent could never read back what it made — it looped on "illusory
  // success" (reliability smoke run, 2026-07-29).
  const stateStore = new FileStateStore(runtimeRunsDir());
  const ws = stateStore.runDir(runId);
  await mkdir(ws, { recursive: true });
  const build = await runtimeAgentFor(a, ws);
  try {
    const res = await run(build.agent, a.prompt, { stateStore, policies: build.policies, runId });
    return {
      id: res.runId,
      automationId: a.id,
      assetVersion: a.assetHash,
      trigger,
      startedAt: started.toISOString(),
      status: res.status,
      output: { kind: "runtime", runDir: stateStore.runDir(res.runId), finalText: res.finalText },
      durationMs: Date.now() - started.getTime(),
    };
  } finally {
    await build.close();
  }
}

async function executeBuilder(a: Automation, trigger: AutomationTrigger, started: Date, runId: string): Promise<AutomationRun> {
  if (a.brainRef.kind !== "builder") throw new Error(`"${a.name}" is not builder-brained.`);
  const builder = await getBuilder(a.brainRef.builderId);
  if (!builder) throw new Error(`No Builder profile "${a.brainRef.builderId}" — was it deleted?`);
  const ws = workspaceDir(a.id);
  await mkdir(ws, { recursive: true });
  const res = await runBuilderChat({ builder, prompt: a.prompt, cwd: ws, emit: () => {} });
  return {
    id: runId,
    automationId: a.id,
    assetVersion: a.assetHash,
    trigger,
    startedAt: started.toISOString(),
    status: res.error ? "failed" : "done",
    output: { kind: "builder", text: res.text, error: res.error },
    durationMs: res.durationMs,
  };
}

/**
 * Run an automation now, against the cap. Throws CapReached / AlreadyRunning.
 * The caller (tick or route) owns the decision to fire; this owns the run.
 */
export async function fireAutomation(id: string, trigger: AutomationTrigger): Promise<AutomationRun> {
  if (sched.running.has(id)) throw new AlreadyRunning((await getAutomation(id)) ?? ({ name: id } as Automation));
  const now = new Date();
  const claimed = await claimRun(id, now, trigger);
  // The runId is minted up front so the in-flight marker can name the state
  // file the run is writing into from its first second, not just at the end.
  const runId = randomUUID();
  sched.running.set(id, { runId, sinceMs: now.getTime() });
  try {
    let rec: AutomationRun;
    try {
      rec = claimed.brainRef.kind !== "builder"
        ? await executeRuntime(claimed, trigger, now, runId)
        : await executeBuilder(claimed, trigger, now, runId);
    } catch (e) {
      // A run that could not even execute (deleted profile, unwritable
      // workspace) still gets a record — a silent failure in an unattended
      // system is the worst kind. The attempt already counted against the cap.
      rec = {
        id: runId,
        automationId: id,
        trigger,
        startedAt: now.toISOString(),
        status: "failed",
        output: claimed.brainRef.kind !== "builder"
          ? { kind: "runtime", runDir: "", finalText: String((e as Error)?.message ?? e) }
          : { kind: "builder", text: "", error: String((e as Error)?.message ?? e) },
        durationMs: Date.now() - now.getTime(),
        assetVersion: claimed.assetHash,
      };
    }
    await writeRunRecord(rec);
    await setLastRun(id, rec.startedAt);
    return rec;
  } finally {
    sched.running.delete(id);
  }
}

// ------------------------------------------------------------------ the tick

interface SchedulerStore {
  timer: ReturnType<typeof setInterval> | null;
  /**
   * Automation ids with a run in flight — the skip-on-overlap set, doubled as
   * the live-progress marker: the runId and start time are what the API
   * surfaces as `inFlight`. In-process only, by design — a dashboard restart
   * loses the marker while the run itself lives on in its state file.
   */
  running: Map<string, { runId: string; sinceMs: number }>;
  /** Reentrancy guard for tickNow itself (a slow claim must not double-tick). */
  ticking: boolean;
}

const GLOBAL_KEY = "__agenticOsAutomations";
const sched: SchedulerStore = (globalThis as Record<string, unknown>)[GLOBAL_KEY] as SchedulerStore
  ?? ((globalThis as Record<string, unknown>)[GLOBAL_KEY] = { timer: null, running: new Map(), ticking: false });

/**
 * Start the 60s tick. Called lazily from the first automations API request —
 * importing this module (as QA does) must not start timers in a process that
 * never asked for them. unref'd so the timer never keeps a process alive.
 */
export function ensureScheduler(): void {
  if (sched.timer) return;
  sched.timer = setInterval(() => { void tickNow(); }, TICK_MS);
  sched.timer.unref?.();
}

/** Is a run of this automation in flight right now? (The overlap set, surfaced.) */
export function isAutomationRunning(id: string): boolean {
  return sched.running.has(id);
}

export interface InFlightAutomation {
  automationId: string;
  runId: string;
  /** Epoch ms the run was claimed — "running since". */
  sinceMs: number;
}

/**
 * Every run in flight right now, with the runId its state file answers to.
 * Read-only view of the overlap set: entries appear when a run fires and are
 * removed when it settles, success or failure (fireAutomation's finally).
 */
export function inFlightAutomations(): InFlightAutomation[] {
  return [...sched.running.entries()].map(([automationId, v]) => ({
    automationId, runId: v.runId, sinceMs: v.sinceMs,
  }));
}

/** One displayable line for a step — the live surfaces show these verbatim. */
function stepLine(s: RunStep): string | null {
  const raw = s.text ?? (s.kind === "tool" && s.name ? `tool: ${s.name}` : null);
  if (!raw) return null;
  const one = raw.replace(/\s+/g, " ").trim();
  return one.length > 160 ? `${one.slice(0, 160)}…` : one;
}

/** The last step line of a run's state file, or null when there is none yet
 * (a builder one-shot has no state file at all). Never throws — a half-written
 * or foreign state file must not take the list endpoint down with it. */
export async function lastStepText(runId: string): Promise<string | null> {
  let state: RunState | null = null;
  try { state = await new FileStateStore(runtimeRunsDir()).load(runId); }
  catch { return null; }
  if (!state) return null;
  for (let i = state.steps.length - 1; i >= 0; i--) {
    const line = stepLine(state.steps[i]);
    if (line) return line;
  }
  return null;
}

export interface LiveRunState {
  runId: string;
  status: "running";
  /** The tail of the step trace (newest last), for the live transcript view. */
  steps: RunStep[];
  lastStep: string | null;
}

/**
 * The live state of an in-flight run, straight from its state file — the run
 * record does not exist until the run settles, so this is the only honest
 * answer while it runs. Steps are capped to the last `tail`.
 */
export async function readLiveRun(runId: string, tail = 8): Promise<LiveRunState> {
  let state: RunState | null = null;
  try { state = await new FileStateStore(runtimeRunsDir()).load(runId); }
  catch { state = null; }
  if (!state) return { runId, status: "running", steps: [], lastStep: null };
  const steps = state.steps.slice(-tail);
  let lastStep: string | null = null;
  for (let i = state.steps.length - 1; i >= 0 && !lastStep; i--) lastStep = stepLine(state.steps[i]);
  return { runId, status: "running", steps, lastStep };
}

/**
 * One scheduler pass, exported so QA can fire it deterministically instead of
 * waiting out a 60s interval. Due automations are claimed and fired
 * un-awaited — a run parked on an approval must never block the next tick.
 */
export async function tickNow(now: Date = new Date()): Promise<void> {
  if (sched.ticking) return;
  sched.ticking = true;
  try {
    for (const a of await listAutomations()) {
      if (!a.enabled) continue;
      if (new Date(a.nextRunAt).getTime() > now.getTime()) continue;
      if (sched.running.has(a.id)) {
        await recordSkip(a.id, now, "overlap: the previous run is still going");
        continue;
      }
      // CapReached is recorded inside claimRun (lastSkip + park until
      // tomorrow); the tick just moves on to the next automation.
      void fireAutomation(a.id, "schedule").catch(() => {});
    }
  } finally {
    sched.ticking = false;
  }
}

// ------------------------------------------------------------------ run history

export async function listRuns(automationId: string): Promise<{ runs: AutomationRun[]; corrupt: string[] }> {
  const dir = runsDir();
  if (!existsSync(dir)) return { runs: [], corrupt: [] };
  const runs: AutomationRun[] = [];
  const corrupt: string[] = [];
  for (const name of await readdir(dir)) {
    if (!name.endsWith(".json")) continue;
    try {
      const rec = JSON.parse(await readFile(path.join(dir, name), "utf8")) as AutomationRun;
      if (rec.automationId === automationId) runs.push(rec);
    } catch {
      // A run record that cannot be read is named, not hidden and not fatal to
      // the rest of the list — the file itself stays untouched, as ever.
      corrupt.push(name);
    }
  }
  runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return { runs, corrupt };
}

/** The transcript.md a runtime run wrote, when it exists (capped for the UI).
 * A run still in flight has no record yet — fall back to its state-file run
 * dir, where the runner rewrites transcript.md after every step. */
export async function readTranscript(runId: string, maxChars = 50_000): Promise<string | null> {
  const rec = await readRunRecord(runId);
  const runDir = rec
    ? (rec.output.kind === "runtime" ? rec.output.runDir : null)
    : new FileStateStore(runtimeRunsDir()).runDir(runId);
  if (!runDir) return null;
  const f = path.join(runDir, "transcript.md");
  if (!existsSync(f)) return null;
  const text = await readFile(f, "utf8");
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n\n… (truncated)` : text;
}

// ------------------------------------------------------- decide from the inbox

export interface ExecuteDecisionResult {
  item: ApprovalItem;
  /** False when another decide won the race, or the item had expired. */
  executed: boolean;
  /** Why an item that WAS won still did not run (no run record, not resumable). */
  executeError?: string;
  runStatus?: string;
}

/**
 * Answer an inbox ask and, when it was approved, finish the run it came from.
 *
 * Decide-before-execute is the ordering guarantee: the item is marked decided
 * (atomically, first-responder-wins) BEFORE anything resumes, so a crash here
 * leaves a decided ask and a blocked run — never an executed tool with no
 * recorded yes. The loser of a race changes nothing and runs nothing.
 */
export async function decideAndExecute(approvalId: string, decision: "approve" | "reject"): Promise<ExecuteDecisionResult> {
  const { item, won } = await decideApproval(approvalId, decision);
  if (!won) return { item, executed: false };

  const rec = await readRunRecord(item.runId).catch(() => null);
  if (!rec) {
    return {
      item, executed: false,
      executeError: "This ask names no automation run, so the inbox cannot resume it. "
        + "(Sen-parked asks are decided here but resumed from their own surface in v1.)",
    };
  }
  const a = await getAutomation(rec.automationId);
  if (!a || a.brainRef.kind === "builder") {
    return { item, executed: false, executeError: "The automation this run belonged to is gone." };
  }

  const stateStore = new FileStateStore(runtimeRunsDir());
  // Resume into the SAME root the run started with (its run dir), not a fresh
  // per-automation workspace — the run's own files and deliverables live there.
  const ws = stateStore.runDir(item.runId);
  await mkdir(ws, { recursive: true });
  const build = await runtimeAgentFor(a, ws);
  const resumeStart = Date.now();
  let res: RunResult;
  try {
    res = await resume(build.agent, item.runId, {
      stateStore,
      policies: build.policies,
      approval: decision === "approve" ? "approve" : "deny",
    });
  } catch (e) {
    await build.close();
    return { item, executed: false, executeError: String((e as Error)?.message ?? e) };
  }
  await build.close();

  // The run record rides along: a blocked run that just finished reads as done,
  // and its duration grows by the resume, not by a fresh start.
  await writeRunRecord({
    ...rec,
    status: res.status,
    output: { kind: "runtime", runDir: stateStore.runDir(res.runId), finalText: res.finalText },
    durationMs: rec.durationMs + (Date.now() - resumeStart),
  });
  return { item, executed: true, runStatus: res.status };
}
