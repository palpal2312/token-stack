/**
 * Local-only orchestration state machine (S09-C9).
 *
 * Appends one JSONL event per state transition for a lane/task. The event
 * journal is the single source of truth: lane state is always derived by
 * replaying the journal (append-only, never rewritten). The consumer surface
 * (API + dashboard page) is read-only; the writer is controller-gated.
 *
 * Privacy: summary strings are redacted one-liners. They are rejected if they
 * carry prompt, conversation, or credential-class content. Events never carry
 * terminal text, source/diff content, or accounts/capability material.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const ORCHESTRATION_STATES = [
  "QUEUED",
  "DISPATCHED",
  "RUNNING",
  "WAITING_ON",
  "DONE",
  "BLOCKED",
  "FAILED",
] as const;

export type OrchestrationState = (typeof ORCHESTRATION_STATES)[number];

/**
 * Required chain (S09-C9): QUEUED -> DISPATCHED -> RUNNING|WAITING_ON ->
 * DONE|BLOCKED|FAILED. WAITING_ON may resume to RUNNING when the prerequisite
 * clears; RUNNING may pause into WAITING_ON. Terminal states have no exit.
 * QUEUED is the only valid first event for a lane.
 */
export const ALLOWED_TRANSITIONS: Record<
  OrchestrationState,
  readonly OrchestrationState[]
> = {
  QUEUED: ["DISPATCHED"],
  DISPATCHED: ["RUNNING", "WAITING_ON"],
  RUNNING: ["WAITING_ON", "DONE", "BLOCKED", "FAILED"],
  WAITING_ON: ["RUNNING", "DONE", "BLOCKED", "FAILED"],
  DONE: [],
  BLOCKED: [],
  FAILED: [],
};

/** Terminal states accept no further events for the lane. */
const TERMINAL: ReadonlySet<OrchestrationState> = new Set(["DONE", "BLOCKED", "FAILED"]);

/**
 * Physical Orca lanes are first-class lifecycle machines (Sprint 09): a lane
 * reports when its work starts (RUNNING), pauses/holds with a reason, resumes,
 * or ends (DONE). Lane lifecycle events use lane ids lane-a/lane-b/lane-c and
 * validate against this machine; tasks keep the QUEUED->... machine above.
 */
export const LANE_IDS = ["lane-a", "lane-b", "lane-c"] as const;

export const LANE_LIFECYCLE_STATES = [
  "IDLE",
  "DISPATCHED",
  "RUNNING",
  "HOLD_INTERNAL",
  "HOLD_LANE",
  "HOLD_APPROVAL",
  "HOLD_TIME",
  "DONE",
] as const;

export type LaneLifecycleState = (typeof LANE_LIFECYCLE_STATES)[number];

/**
 * DISPATCHED = Orca has called the lane and it has not answered yet (ACTIVE).
 * RUNNING = the lane is executing a task without stalling (WORKING).
 */
export const LANE_LIFECYCLE_TRANSITIONS: Record<
  LaneLifecycleState,
  readonly LaneLifecycleState[]
> = {
  IDLE: ["RUNNING", "DISPATCHED"],
  DISPATCHED: ["RUNNING", "DONE", "HOLD_INTERNAL", "HOLD_LANE", "HOLD_APPROVAL", "HOLD_TIME"],
  RUNNING: ["DONE", "HOLD_INTERNAL", "HOLD_LANE", "HOLD_APPROVAL", "HOLD_TIME"],
  HOLD_INTERNAL: ["RUNNING", "DONE"],
  HOLD_LANE: ["RUNNING", "DONE"],
  HOLD_APPROVAL: ["RUNNING", "DONE"],
  HOLD_TIME: ["RUNNING", "DONE"],
  DONE: ["RUNNING"],
};

export function isLaneId(lane: string): boolean {
  return (LANE_IDS as readonly string[]).includes(lane);
}


/**
 * Contract-aligned forbidden content markers. A redacted summary must contain
 * none of these (prompts, conversations, raw logs, secrets, tokens,
 * credentials, private keys, source code, or diffs are never persisted).
 */
const FORBIDDEN_SUMMARY_MARKERS = [
  "prompt",
  "conversation",
  "user story",
  "raw log",
  "terminal",
  "secret",
  "credential",
  "private key",
  "api key",
  "password",
  "bearer",
  "source code",
  "diff",
  "-----begin",
  "```",
];

export interface OrchestrationEvent {
  /** Lane/partition owning the task chain, e.g. `community` or `integration`. */
  lane: string;
  /** Task/job label within the lane, e.g. `S09-C1-COMMUNITY-INTAKE`. */
  task: string;
  /** Target state after this event (task machine or lane lifecycle). */
  transition: OrchestrationState | LaneLifecycleState;
  /** ISO-8601 timestamp; defaults to now when omitted. */
  time?: string;
  /** Named dependency the lane is waiting on (WAITING_ON only). */
  prerequisite?: string;
  /** Relative evidence path in the repository (optional; paired with hash). */
  evidencePath?: string;
  /** SHA-256 of the referenced evidence (optional; must pair with path). */
  evidenceSha256?: string;
  /** Redacted, bounded one-line summary. */
  summary: string;
}

export interface OrchestrationLaneView {
  lane: string;
  task: string;
  currentState: string;
  prerequisite?: string;
  evidence?: { path: string; sha256: string };
  lastEventAt?: string;
  timeline: OrchestrationEvent[];
}

const SHA256_RE = /^[a-f0-9]{64}$/i;
const MAX_SUMMARY_LEN = 200;

export function defaultStatePath(): string {
  const base = process.env.AGENTIC_OS_HOME ?? path.join(os.homedir(), ".agentic-os");
  return path.join(base, "orchestration-state.jsonl");
}

/** True while writes are explicitly authorized for the controller. */
export function isController(): boolean {
  return process.env.ORCHESTRATION_CONTROLLER === "1";
}

export function assertRedactedSummary(summary: string): void {
  if (typeof summary !== "string" || summary.trim().length === 0) {
    throw new Error("summary is required and must be non-empty");
  }
  if (summary.length > MAX_SUMMARY_LEN) {
    throw new Error(`summary exceeds ${MAX_SUMMARY_LEN} characters`);
  }
  const lowered = summary.toLowerCase();
  for (const marker of FORBIDDEN_SUMMARY_MARKERS) {
    if (lowered.includes(marker)) {
      throw new Error(`summary contains a forbidden marker: ${marker}`);
    }
  }
}

/** Validates shape, transition legality, pairing, and redaction. */
export function validateEvent(
  event: OrchestrationEvent,
  currentState: string | null,
): void {
  if (typeof event.lane !== "string" || event.lane.trim().length === 0) {
    throw new Error("lane is required");
  }
  if (typeof event.task !== "string" || event.task.trim().length === 0) {
    throw new Error("task is required");
  }
  const target = event.transition;
  const isOrchestration =
    ORCHESTRATION_STATES.includes(target as OrchestrationState);
  const isLifecycle = LANE_LIFECYCLE_STATES.includes(target as LaneLifecycleState);
  if (!isOrchestration && !isLifecycle) {
    throw new Error(`unknown transition state: ${String(target)}`);
  }
  if (event.time !== undefined && Number.isNaN(Date.parse(event.time))) {
    throw new Error("time must be ISO-8601");
  }
  if (event.prerequisite !== undefined && event.prerequisite.trim().length === 0) {
    throw new Error("prerequisite must be non-empty when present");
  }
  const hasPath = event.evidencePath !== undefined && event.evidencePath.trim().length > 0;
  const hasHash = event.evidenceSha256 !== undefined && event.evidenceSha256.trim().length > 0;
  if (hasPath !== hasHash) {
    throw new Error("evidence path and sha256 must be provided together");
  }
  if (hasHash && !SHA256_RE.test(event.evidenceSha256!)) {
    throw new Error("evidenceSha256 must be a 64-char hex SHA-256");
  }
  assertRedactedSummary(event.summary);

  if (isLaneId(event.lane)) {
    // Lane lifecycle machine (report of start/hold/end for a physical lane).
    const from = currentState as LaneLifecycleState | null;
    if (from === null) {
      if (target !== "IDLE" && target !== "RUNNING" && target !== "DISPATCHED") {
        throw new Error(`first event for a lifecycle lane must be IDLE, RUNNING or DISPATCHED, got ${target}`);
      }
      return;
    }
    if (!LANE_LIFECYCLE_TRANSITIONS[from].includes(target as LaneLifecycleState)) {
      throw new Error(`invalid lane transition ${from} -> ${target}`);
    }
    return;
  }

  const taskPrior = currentState as OrchestrationState | null;
  if (taskPrior === null) {
    if (target !== "QUEUED") {
      throw new Error(`first event for a lane must be QUEUED, got ${target}`);
    }
    return;
  }
  if (TERMINAL.has(taskPrior)) {
    throw new Error(`lane is terminal (${taskPrior}); no further transitions allowed`);
  }
  if (!ALLOWED_TRANSITIONS[taskPrior].includes(target as OrchestrationState)) {
    throw new Error(`invalid transition ${taskPrior} -> ${target}`);
  }
}

export interface SprintRoadmap {
  total: number;
  closed: number;
  doing: number;
  current: number | null;
}

/**
 * Derive the sprint roadmap (closed/doing/total) from Orca orchestrate
 * run-manifests under plans/reports. Closed = folder *-close, or manifest
 * status/sprints.*.status starting with "closed". doing = status "active".
 * ponytail: scanned per request; cache only if the preview ever lags.
 */
export function deriveSprintRoadmap(reportsDir: string = path.join(process.cwd(), "plans", "reports")): SprintRoadmap | null {
  if (!fs.existsSync(reportsDir)) return null;
  const closed = new Set<number>();
  const doing = new Set<number>();
  const seen = new Set<number>();
  for (const entry of fs.readdirSync(reportsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("orchestrate-")) continue;
    const nums = [...entry.name.matchAll(/sprint(\d{2})(?:-(\d{2}))?/g)].flatMap((m) =>
      [m[1], m[2]].filter(Boolean).map((n) => parseInt(n, 10)),
    );
    // folder forms: sprint01-close, sprint03-chat, sprint05-07-multi-sprint
    const rangeClosed = /-close\/?$/.test(entry.name);
    if (rangeClosed && nums.length === 2 && nums[0] < nums[1]) {
      for (let n = nums[0]; n <= nums[1]; n += 1) closed.add(n);
    }
    const manifestFile = path.join(reportsDir, entry.name, "run-manifest.json");
    if (nums.length === 1 && rangeClosed) closed.add(nums[0]);
    for (const n of nums) seen.add(n);
    if (!fs.existsSync(manifestFile)) continue;
    let manifest: { status?: string; sprints?: Record<string, { status?: string }> };
    try {
      manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    } catch {
      continue;
    }
    if (manifest.sprints) {
      for (const [num, value] of Object.entries(manifest.sprints)) {
        const n = parseInt(num, 10);
        seen.add(n);
        const status = String(value?.status ?? "");
        if (status.startsWith("closed")) closed.add(n);
        else if (status === "active") doing.add(n);
      }
    } else if (typeof manifest.status === "string" && nums.length) {
      for (const n of nums) {
        if (manifest.status.startsWith("closed")) closed.add(n);
        else if (manifest.status === "active") doing.add(n);
      }
    }
  }
  if (seen.size === 0) return null;
  const active = [...doing].sort((a, b) => a - b);
  return {
    total: Math.max(...seen),
    closed: closed.size,
    doing: doing.size,
    current: active[0] ?? null,
  };
}

export class OrchestrationStateStore {
  readonly statePath: string;

  constructor(statePath: string = defaultStatePath()) {
    this.statePath = statePath;
  }

  private ensureFile(): void {
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
    if (!fs.existsSync(this.statePath)) {
      fs.writeFileSync(this.statePath, "", { flag: "a" });
    }
  }

  /**
   * Controller-only writer. Requires either the explicit env gate
   * ORCHESTRATION_CONTROLLER=1 or controller: true. Append-only: the event is
   * validated and written as one JSON line; nothing is ever rewritten.
   */
  append(event: OrchestrationEvent, opts: { controller?: boolean } = {}): OrchestrationEvent {
    if (!opts.controller && !isController()) {
      throw new Error(
        "controller-only writer: set ORCHESTRATION_CONTROLLER=1 or pass controller: true",
      );
    }
    const prior = this.currentState(event.lane);
    validateEvent(event, prior);
    const line: OrchestrationEvent = {
      ...event,
      time: event.time ?? new Date().toISOString(),
    };
    this.ensureFile();
    fs.appendFileSync(this.statePath, `${JSON.stringify(line)}\n`, "utf8");
    return line;
  }

  readEvents(): OrchestrationEvent[] {
    if (!fs.existsSync(this.statePath)) return [];
    const events: OrchestrationEvent[] = [];
    const lines = fs.readFileSync(this.statePath, "utf8").split("\n");
    for (const lineText of lines) {
      const trimmed = lineText.trim();
      if (trimmed.length === 0) continue;
      events.push(JSON.parse(trimmed) as OrchestrationEvent);
    }
    return events;
  }

  currentState(lane: string): string | null {
    const events = this.readEvents().filter((e) => e.lane === lane);
    if (events.length === 0) return null;
    return events[events.length - 1].transition;
  }

  deriveLanes(): OrchestrationLaneView[] {
    const events = this.readEvents();
    const byLane = new Map<string, OrchestrationEvent[]>();
    for (const event of events) {
      const list = byLane.get(event.lane) ?? [];
      list.push(event);
      byLane.set(event.lane, list);
    }
    const views: OrchestrationLaneView[] = [];
    for (const [lane, timeline] of byLane) {
      const last = timeline[timeline.length - 1];
      views.push({
        lane,
        task: last.task,
        currentState: last.transition,
        prerequisite: last.prerequisite,
        evidence: last.evidencePath && last.evidenceSha256
          ? { path: last.evidencePath, sha256: last.evidenceSha256 }
          : undefined,
        lastEventAt: last.time,
        timeline,
      });
    }
    return views.sort((a, b) => a.lane.localeCompare(b.lane));
  }
}