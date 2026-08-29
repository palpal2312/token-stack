export interface WorkflowStep {
  id: string;
  type: "tool" | "agent" | "condition" | "approval";
  action: string;
  args?: Record<string, unknown>;
  next?: string | Record<string, string>;
  retry?: {
    maxAttempts: number;
    delayMs: number;
  };
}

export interface WorkflowSchema {
  version: 1;
  id: string;
  name: string;
  startStep: string;
  steps: Record<string, WorkflowStep>;
}

export class WorkflowValidator {
  static validate(schema: any): { ok: boolean; errors: string[] } {
    const errors: string[] = [];
    if (!schema || schema.version !== 1) errors.push("Invalid schema version");
    if (!schema.startStep || !schema.steps || !schema.steps[schema.startStep]) {
      errors.push("Missing or invalid startStep");
    }

    // Check cycles and missing refs
    const visited = new Set<string>();
    const stack = new Set<string>();

    function dfs(stepId: string) {
      if (stack.has(stepId)) {
        errors.push(`Cycle detected at step ${stepId}`);
        return;
      }
      if (visited.has(stepId)) return;

      const step = schema.steps[stepId];
      if (!step) {
        errors.push(`Missing reference to step ${stepId}`);
        return;
      }

      visited.add(stepId);
      stack.add(stepId);

      if (step.next) {
        if (typeof step.next === "string") {
          dfs(step.next);
        } else {
          for (const nextId of Object.values(step.next as Record<string, string>)) {
            dfs(nextId);
          }
        }
      }
      stack.delete(stepId);
    }

    if (schema.startStep && schema.steps[schema.startStep]) {
      dfs(schema.startStep);
    }

    return { ok: errors.length === 0, errors };
  }
}

import { JobQueue } from "./jobs";
import { createHash, randomUUID } from "node:crypto";
import { IAppendOnlyRepository, JsonlStorageRepository, StorageError } from "./storage";

export class WorkflowCompiler {
  static async compile(schema: WorkflowSchema, queue: JobQueue, parentRunId: string): Promise<string[]> {
    const jobIds: string[] = [];
    // A real compiler would construct a DAG of jobs based on 'next' properties
    // For now, we compile sequential steps directly into the job queue.
    for (const [id, step] of Object.entries(schema.steps)) {
      const jobId = randomUUID();
      queue.enqueue(jobId, parentRunId, id);
      jobIds.push(jobId);
    }
    return jobIds;
  }
}

// =============================================================================
// Sprint 09 Contract v1 — bounded typed workflow graph (controlled delivery).
//
// Contract pin: plans/reports/orchestrate-260826-sprint08-10/s09-contract
// (s09-contract.md sha256 2750f2f7…30a8ec, s09-contract.json sha256
// 96d9dadb…f74f8d59d6, independent arbiter GO 2026-08-28).
//
// Rules implemented here:
// - Typed nodes/edges with a deterministic graph hash (canonical JSON SHA-256).
// - Bounds: max depth 32, max nodes 128, max loop iterations 100. Cycles are
//   only legal through explicitly bounded loop back-edges.
// - Budget, cancellation (fencing), checkpoint, retry/fallback, and merge-queue
//   policies are mandatory and validated fail-closed.
// - The parent Task remains the execution authority: every run is opened under
//   a parentTaskId and every child Attempt event carries runId back to it.
// - Child Attempts are durable and auditable: run state is event-sourced into
//   an append-only repository (same pattern as JobQueue), and the full attempt
//   transition history is derivable by replay.
// - Validation and compilation are deterministic: same bytes in, same errors,
//   same graph hash, same plan out.
// - Crash-resume: runs rebuild purely by replaying the event log; in-flight
//   attempts are orphaned and re-executed, succeeded attempts are never
//   re-run.
// - Merge safety: exclusive resources are leased single-writer via CAS;
//   cancellation fences all post-cancel run writes.
// =============================================================================

export const S09_GRAPH_LIMITS = {
  maxNodes: 128,
  maxDepth: 32,
  maxLoopIterations: 100,
} as const;

export type WorkflowGraphNodeType = "tool" | "agent" | "condition" | "approval";

const NODE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const RESOURCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;

export interface WorkflowGraphRetryPolicy {
  /** Total attempts per node occurrence, including the first. >= 1. */
  maxAttempts: number;
  /** Backoff before a retry becomes eligible. >= 0. */
  delayMs: number;
  /** Node executed once all retries are exhausted; must reference a graph node. */
  fallbackNodeId?: string;
}

export interface WorkflowGraphNode {
  id: string;
  type: WorkflowGraphNodeType;
  action: string;
  args?: Record<string, unknown>;
  retry?: WorkflowGraphRetryPolicy;
  /** Exclusive merge-queue resources that must be leased before executing. */
  resources?: string[];
}

export interface WorkflowGraphEdge {
  from: string;
  to: string;
  /** Output key that must be truthy for the edge to fire; absent = always. */
  when?: string;
  /** Bounded loop back-edge. Only edges carrying this may close a cycle. */
  loop?: { maxIterations: number };
}

export interface WorkflowGraphPolicies {
  budget: {
    /** Total node attempts across the whole run. >= 1. */
    maxNodeAttempts: number;
    /** Wall-clock run budget. >= 1. */
    maxDurationMs: number;
  };
  cancellation: {
    /** Contract requires true: cancel fences child Attempts and post-cancel writes. */
    fenceOnCancel: boolean;
  };
  checkpoint: {
    /** Append a CHECKPOINT_RECORDED event after every N completed node attempts. >= 1. */
    everyNCompletedNodes: number;
  };
  retry: WorkflowGraphRetryPolicy;
  mergeQueue: {
    /** Resources that exist for this graph; nodes may only declare these. */
    exclusiveResources: string[];
    /** Lease duration for a merge admission; expiry is the crash-recovery path. >= 1. */
    leaseMs: number;
  };
}

export interface WorkflowGraph {
  schemaVersion: 1;
  graphId: string;
  startNodeId: string;
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
  policies: WorkflowGraphPolicies;
  /** Optional pre-computed hash; when present it must match the computed hash. */
  graphHash?: string;
}

/** Deterministic JSON: object keys sorted recursively, array order preserved. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
  return `{${entries.join(",")}}`;
}

/** SHA-256 over the canonical JSON of the graph, excluding any graphHash field. */
export function hashWorkflowGraph(graph: WorkflowGraph): string {
  const { graphHash: _ignored, ...rest } = graph;
  return createHash("sha256").update(canonicalJson(rest), "utf8").digest("hex");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Deterministic structural validation of a Contract v1 workflow graph.
 * Checks run in a fixed order so identical input yields identical errors.
 */
export function validateWorkflowGraph(graph: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!isPlainObject(graph)) return { ok: false, errors: ["graph is not an object"] };

  if (graph.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (typeof graph.graphId !== "string" || graph.graphId.length === 0) errors.push("graphId missing");
  if (typeof graph.startNodeId !== "string" || graph.startNodeId.length === 0) errors.push("startNodeId missing");
  if (!Array.isArray(graph.nodes)) errors.push("nodes must be an array");
  if (!Array.isArray(graph.edges)) errors.push("edges must be an array");
  if (!isPlainObject(graph.policies)) errors.push("policies missing");
  if (errors.length > 0) return { ok: false, errors };

  const nodes = graph.nodes as unknown[];
  const edges = graph.edges as unknown[];
  const policies = graph.policies as Record<string, unknown>;

  // Node identity, typing, and bounds.
  const nodeIds = new Set<string>();
  if (nodes.length > S09_GRAPH_LIMITS.maxNodes) {
    errors.push(`graph exceeds max nodes ${S09_GRAPH_LIMITS.maxNodes}: has ${nodes.length}`);
  }
  for (const raw of nodes) {
    if (!isPlainObject(raw)) { errors.push("node is not an object"); continue; }
    const id = raw.id;
    if (typeof id !== "string" || !NODE_ID_PATTERN.test(id)) {
      errors.push(`node id invalid: ${String(id)}`);
      continue;
    }
    if (nodeIds.has(id)) errors.push(`duplicate node id: ${id}`);
    nodeIds.add(id);
    if (!["tool", "agent", "condition", "approval"].includes(raw.type as string)) {
      errors.push(`node ${id} has unknown type: ${String(raw.type)}`);
    }
    if (typeof raw.action !== "string" || raw.action.length === 0) {
      errors.push(`node ${id} missing action`);
    }
    validateRetryPolicy(raw.retry, `node ${id}`, errors);
    if (raw.resources !== undefined) {
      if (!Array.isArray(raw.resources) || raw.resources.some((r) => typeof r !== "string" || !RESOURCE_PATTERN.test(r as string))) {
        errors.push(`node ${id} has invalid resources`);
      }
    }
  }

  if (!nodeIds.has(graph.startNodeId as string)) {
    errors.push(`startNodeId does not reference a node: ${String(graph.startNodeId)}`);
  }

  // Edge typing, references, and loop bounds.
  const loopEdges: WorkflowGraphEdge[] = [];
  const forwardEdges: WorkflowGraphEdge[] = [];
  for (const raw of edges) {
    if (!isPlainObject(raw)) { errors.push("edge is not an object"); continue; }
    const { from, to, when, loop } = raw as unknown as WorkflowGraphEdge;
    if (typeof from !== "string" || !nodeIds.has(from)) { errors.push(`edge from unknown node: ${String(from)}`); continue; }
    if (typeof to !== "string" || !nodeIds.has(to)) { errors.push(`edge to unknown node: ${String(to)}`); continue; }
    if (when !== undefined && typeof when !== "string") errors.push(`edge ${from}->${to} has non-string when`);
    if (loop !== undefined) {
      if (!isPlainObject(loop) || !isPositiveInt(loop.maxIterations)) {
        errors.push(`edge ${from}->${to} loop.maxIterations must be a positive integer`);
      } else if (loop.maxIterations > S09_GRAPH_LIMITS.maxLoopIterations) {
        errors.push(`edge ${from}->${to} loop exceeds max iterations ${S09_GRAPH_LIMITS.maxLoopIterations}: ${loop.maxIterations}`);
      }
      loopEdges.push({ from, to, when, loop } as WorkflowGraphEdge);
    } else {
      forwardEdges.push({ from, to, when } as WorkflowGraphEdge);
    }
  }

  // Bounded cycles: removing loop edges must leave a DAG, so every cycle is
  // closed by a bounded edge and cannot iterate unboundedly.
  if (hasCycle(forwardEdges)) {
    errors.push("unbounded cycle detected: cycles require a bounded loop edge");
  }

  // Depth bound: longest path from start over forward edges only (a DAG by the
  // check above), so memoized DFS terminates.
  if (nodeIds.has(graph.startNodeId as string) && !hasCycle(forwardEdges)) {
    const adjacency = new Map<string, string[]>();
    for (const edge of forwardEdges) {
      const list = adjacency.get(edge.from) ?? [];
      list.push(edge.to);
      adjacency.set(edge.from, list);
    }
    const memo = new Map<string, number>();
    const depthFrom = (id: string, stack: Set<string>): number => {
      const hit = memo.get(id);
      if (hit !== undefined) return hit;
      if (stack.has(id)) return 0;
      stack.add(id);
      let best = 1;
      for (const next of adjacency.get(id) ?? []) best = Math.max(best, 1 + depthFrom(next, stack));
      stack.delete(id);
      memo.set(id, best);
      return best;
    };
    const depth = depthFrom(graph.startNodeId as string, new Set());
    if (depth > S09_GRAPH_LIMITS.maxDepth) {
      errors.push(`graph exceeds max depth ${S09_GRAPH_LIMITS.maxDepth}: ${depth}`);
    }
  }

  // Policies: presence, bounds, fail-closed cancellation.
  const budget = policies.budget as Record<string, unknown> | undefined;
  if (!isPlainObject(budget) || !isPositiveInt(budget.maxNodeAttempts) || !isPositiveInt(budget.maxDurationMs)) {
    errors.push("policies.budget requires positive integer maxNodeAttempts and maxDurationMs");
  }
  const cancellation = policies.cancellation as Record<string, unknown> | undefined;
  if (!isPlainObject(cancellation) || cancellation.fenceOnCancel !== true) {
    errors.push("policies.cancellation.fenceOnCancel must be true");
  }
  const checkpoint = policies.checkpoint as Record<string, unknown> | undefined;
  if (!isPlainObject(checkpoint) || !isPositiveInt(checkpoint.everyNCompletedNodes)) {
    errors.push("policies.checkpoint.everyNCompletedNodes must be a positive integer");
  }
  validateRetryPolicy(policies.retry, "policies.retry", errors);
  const mergeQueue = policies.mergeQueue as Record<string, unknown> | undefined;
  const declaredResources = new Set<string>();
  if (!isPlainObject(mergeQueue) || !Array.isArray(mergeQueue.exclusiveResources) || !isPositiveInt(mergeQueue.leaseMs)) {
    errors.push("policies.mergeQueue requires exclusiveResources array and positive integer leaseMs");
  } else {
    for (const resource of mergeQueue.exclusiveResources) {
      if (typeof resource !== "string" || !RESOURCE_PATTERN.test(resource)) {
        errors.push(`merge-queue resource invalid: ${String(resource)}`);
      } else if (declaredResources.has(resource)) {
        errors.push(`merge-queue resource duplicated: ${resource}`);
      } else {
        declaredResources.add(resource);
      }
    }
    for (const raw of nodes) {
      if (!isPlainObject(raw) || !Array.isArray(raw.resources)) continue;
      for (const resource of raw.resources as string[]) {
        if (typeof resource === "string" && !declaredResources.has(resource)) {
          errors.push(`node ${String(raw.id)} declares undeclared merge-queue resource: ${resource}`);
        }
      }
    }
  }

  // Retry fallbacks and loop edges reference real nodes (fallback checked here
  // because it needs the full id set).
  const checkFallback = (policy: unknown, label: string) => {
    if (isPlainObject(policy) && policy.fallbackNodeId !== undefined) {
      if (typeof policy.fallbackNodeId !== "string" || !nodeIds.has(policy.fallbackNodeId)) {
        errors.push(`${label} fallbackNodeId references unknown node: ${String(policy.fallbackNodeId)}`);
      }
    }
  };
  for (const raw of nodes) if (isPlainObject(raw)) checkFallback(raw.retry, `node ${String(raw.id)}`);
  checkFallback(policies.retry, "policies.retry");

  // A declared hash must match the computed one (drift fails closed).
  if (errors.length === 0 && graph.graphHash !== undefined) {
    if (graph.graphHash !== hashWorkflowGraph(graph as unknown as WorkflowGraph)) {
      errors.push("graphHash does not match computed hash");
    }
  }

  return { ok: errors.length === 0, errors };
}

function validateRetryPolicy(policy: unknown, label: string, errors: string[]): void {
  if (policy === undefined) return;
  if (!isPlainObject(policy) || !isPositiveInt(policy.maxAttempts) || !isNonNegativeNumber(policy.delayMs)) {
    errors.push(`${label} retry requires positive integer maxAttempts and non-negative delayMs`);
  }
}

function hasCycle(edges: WorkflowGraphEdge[]): boolean {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const list = adjacency.get(edge.from) ?? [];
    list.push(edge.to);
    adjacency.set(edge.from, list);
  }
  const visited = new Set<string>();
  const stack = new Set<string>();
  const visit = (id: string): boolean => {
    if (stack.has(id)) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    stack.add(id);
    for (const next of adjacency.get(id) ?? []) if (visit(next)) return true;
    stack.delete(id);
    return false;
  };
  for (const id of adjacency.keys()) if (visit(id)) return true;
  return false;
}

export interface WorkflowGraphPlanEntry {
  nodeId: string;
  jobId: string;
}

export interface WorkflowGraphCompilation {
  graphHash: string;
  plan: WorkflowGraphPlanEntry[];
}

/**
 * Deterministic compilation: validates fail-closed, then enqueues one job per
 * node under the parent Task's run id. Job ids and idempotency keys derive
 * from the graph hash, so recompiling identical bytes is a no-op replay and
 * conflicting bytes under the same job id fail closed in JobQueue.
 */
export function compileWorkflowGraph(
  graph: WorkflowGraph,
  queue: JobQueue,
  parentTaskId: string,
): WorkflowGraphCompilation {
  const verdict = validateWorkflowGraph(graph);
  if (!verdict.ok) {
    throw new Error(`workflow graph invalid: ${verdict.errors.join("; ")}`);
  }
  const graphHash = hashWorkflowGraph(graph);
  const order = deterministicNodeOrder(graph);
  const plan: WorkflowGraphPlanEntry[] = [];
  for (const nodeId of order) {
    const jobId = `wfg-${graphHash.slice(0, 16)}-${nodeId}`;
    queue.enqueue(jobId, parentTaskId, `${graphHash}:${nodeId}`);
    plan.push({ nodeId, jobId });
  }
  return { graphHash, plan };
}

/** BFS from start over forward edges, ties by node id; leftovers sorted by id. */
function deterministicNodeOrder(graph: WorkflowGraph): string[] {
  const forward = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (edge.loop) continue;
    const list = forward.get(edge.from) ?? [];
    list.push(edge.to);
    forward.set(edge.from, list);
  }
  for (const list of forward.values()) list.sort();
  const seen = new Set<string>([graph.startNodeId]);
  const order: string[] = [];
  const queue: string[] = [graph.startNodeId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of forward.get(id) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  for (const node of graph.nodes) {
    if (!seen.has(node.id)) {
      seen.add(node.id);
      order.push(node.id);
    }
  }
  return order;
}

// -----------------------------------------------------------------------------
// Durable, auditable child Attempts under parent-Task authority (event-sourced).
// -----------------------------------------------------------------------------

export type WorkflowRunTerminalStatus = "succeeded" | "failed" | "cancelled";
export type WorkflowRunStatus = "running" | WorkflowRunTerminalStatus;

export type WorkflowRunEvent =
  | { type: "RUN_STARTED"; runId: string; parentTaskId: string; graphHash: string; budget: { maxNodeAttempts: number; maxDurationMs: number }; timestamp: number }
  | { type: "NODE_SCHEDULED"; runId: string; nodeId: string; occurrence: number; viaLoopEdge: boolean; timestamp: number }
  | { type: "ATTEMPT_STARTED"; runId: string; nodeId: string; occurrence: number; attempt: number; timestamp: number }
  | { type: "ATTEMPT_SUCCEEDED"; runId: string; nodeId: string; occurrence: number; attempt: number; outputHash: string; timestamp: number }
  | { type: "ATTEMPT_FAILED"; runId: string; nodeId: string; occurrence: number; attempt: number; errorClass: string; errorMessage: string; nextEligibleTime?: number; timestamp: number }
  | { type: "ATTEMPT_ORPHANED"; runId: string; nodeId: string; occurrence: number; attempt: number; timestamp: number }
  | { type: "LOOP_ITERATION"; runId: string; edgeKey: string; iteration: number; timestamp: number }
  | { type: "CHECKPOINT_RECORDED"; runId: string; completedAttempts: number; timestamp: number }
  | { type: "RUN_SUCCEEDED"; runId: string; timestamp: number }
  | { type: "RUN_FAILED"; runId: string; reason: string; timestamp: number }
  | { type: "RUN_CANCELLED"; runId: string; reason?: string; timestamp: number };

export type NodeOccurrenceStatus = "scheduled" | "running" | "retry-wait" | "succeeded" | "failed";

export interface NodeOccurrenceState {
  occurrence: number;
  attempt: number;
  status: NodeOccurrenceStatus;
  nextEligibleTime?: number;
  lastError?: string;
}

/** One immutable audit line per attempt transition; the child-Attempt trail. */
export interface AttemptAuditEntry {
  nodeId: string;
  occurrence: number;
  attempt: number;
  transition: "started" | "succeeded" | "failed" | "orphaned";
  errorClass?: string;
  outputHash?: string;
  timestamp: number;
}

export interface WorkflowRunState {
  runId: string;
  parentTaskId: string;
  graphHash: string;
  status: WorkflowRunStatus;
  failureReason?: string;
  budget: { maxNodeAttempts: number; maxDurationMs: number };
  attemptsUsed: number;
  nodes: Record<string, NodeOccurrenceState>;
  loopIterations: Record<string, number>;
  checkpoints: number;
  audit: AttemptAuditEntry[];
  startedAt: number;
  updatedAt: number;
}

/** Thrown when a write targets a run that is already terminal (fenced). */
export class WorkflowFenceError extends Error {
  constructor(runId: string, status: string) {
    super(`run ${runId} is ${status}; post-terminal writes are fenced`);
    this.name = "WorkflowFenceError";
  }
}

const TERMINAL_STATUSES: ReadonlySet<string> = new Set(["succeeded", "failed", "cancelled"]);

/**
 * Append-only, event-sourced run store. All child-Attempt mutations go through
 * `append`, which rejects writes to terminal runs — this is the cancellation
 * fence that prevents post-cancel writes. Replay of the log is the only state
 * construction path, which is what makes crash-resume exact.
 */
export class WorkflowRunStore {
  private repo: IAppendOnlyRepository<WorkflowRunEvent, WorkflowRunState>;

  constructor(repo?: IAppendOnlyRepository<WorkflowRunEvent, WorkflowRunState>) {
    this.repo = repo ?? new JsonlStorageRepository<WorkflowRunEvent, WorkflowRunState>("workflow-runs");
  }

  /** Appends an event with CAS on the read revision. Fences terminal runs. */
  public append(runId: string, event: WorkflowRunEvent): WorkflowRunState {
    const existing = this.read(runId);
    if (existing && TERMINAL_STATUSES.has(existing.state.status)) {
      // Idempotent replay of an identical cancel is tolerated; everything else fenced.
      if (event.type === "RUN_CANCELLED" && existing.state.status === "cancelled") {
        return existing.state;
      }
      throw new WorkflowFenceError(runId, existing.state.status);
    }
    if (!existing && event.type !== "RUN_STARTED") {
      throw new Error(`run ${runId} does not exist`);
    }
    try {
      this.repo.append(runId, event, existing?.revision ?? 0);
    } catch (err) {
      if (err instanceof StorageError && err.code === "CONCURRENCY_CONFLICT") {
        throw new WorkflowFenceError(runId, "concurrently modified");
      }
      throw err;
    }
    return this.read(runId)!.state;
  }

  public read(runId: string): { state: WorkflowRunState; revision: number } | null {
    const events = this.repo.readEvents(runId);
    if (events.length === 0) return null;
    let state: WorkflowRunState | null = null;
    let revision = 0;
    for (const event of events) {
      state = reduceWorkflowRun(state, event);
      revision++;
    }
    return state ? { state, revision } : null;
  }

  public rawEvents(runId: string): WorkflowRunEvent[] {
    return this.repo.readEvents(runId);
  }
}

export function reduceWorkflowRun(state: WorkflowRunState | null, event: WorkflowRunEvent): WorkflowRunState {
  switch (event.type) {
    case "RUN_STARTED":
      return {
        runId: event.runId,
        parentTaskId: event.parentTaskId,
        graphHash: event.graphHash,
        status: "running",
        budget: { ...event.budget },
        attemptsUsed: 0,
        nodes: {},
        loopIterations: {},
        checkpoints: 0,
        audit: [],
        startedAt: event.timestamp,
        updatedAt: event.timestamp,
      };
    case "NODE_SCHEDULED": {
      const run = requireState(state, event);
      const current = run.nodes[event.nodeId];
      // Idempotent replay guard: a duplicate schedule for an already-live or
      // completed occurrence is a no-op (dedupe on re-emit / merge replay).
      if (current && current.occurrence === event.occurrence && current.status !== "failed") {
        return { ...run, updatedAt: event.timestamp };
      }
      return {
        ...run,
        nodes: {
          ...run.nodes,
          [event.nodeId]: { occurrence: event.occurrence, attempt: 0, status: "scheduled" },
        },
        updatedAt: event.timestamp,
      };
    }
    case "ATTEMPT_STARTED": {
      const run = requireState(state, event);
      return {
        ...run,
        attemptsUsed: run.attemptsUsed + 1,
        nodes: {
          ...run.nodes,
          [event.nodeId]: { occurrence: event.occurrence, attempt: event.attempt, status: "running" },
        },
        audit: [...run.audit, { nodeId: event.nodeId, occurrence: event.occurrence, attempt: event.attempt, transition: "started", timestamp: event.timestamp }],
        updatedAt: event.timestamp,
      };
    }
    case "ATTEMPT_SUCCEEDED": {
      const run = requireState(state, event);
      return {
        ...run,
        nodes: {
          ...run.nodes,
          [event.nodeId]: { occurrence: event.occurrence, attempt: event.attempt, status: "succeeded" },
        },
        audit: [...run.audit, { nodeId: event.nodeId, occurrence: event.occurrence, attempt: event.attempt, transition: "succeeded", outputHash: event.outputHash, timestamp: event.timestamp }],
        updatedAt: event.timestamp,
      };
    }
    case "ATTEMPT_FAILED": {
      const run = requireState(state, event);
      return {
        ...run,
        nodes: {
          ...run.nodes,
          [event.nodeId]: {
            occurrence: event.occurrence,
            attempt: event.attempt,
            status: event.nextEligibleTime !== undefined ? "retry-wait" : "failed",
            nextEligibleTime: event.nextEligibleTime,
            lastError: `${event.errorClass}: ${event.errorMessage}`,
          },
        },
        audit: [...run.audit, { nodeId: event.nodeId, occurrence: event.occurrence, attempt: event.attempt, transition: "failed", errorClass: event.errorClass, timestamp: event.timestamp }],
        updatedAt: event.timestamp,
      };
    }
    case "ATTEMPT_ORPHANED": {
      const run = requireState(state, event);
      return {
        ...run,
        nodes: {
          ...run.nodes,
          [event.nodeId]: { occurrence: event.occurrence, attempt: event.attempt, status: "scheduled" },
        },
        audit: [...run.audit, { nodeId: event.nodeId, occurrence: event.occurrence, attempt: event.attempt, transition: "orphaned", timestamp: event.timestamp }],
        updatedAt: event.timestamp,
      };
    }
    case "LOOP_ITERATION": {
      const run = requireState(state, event);
      return {
        ...run,
        loopIterations: { ...run.loopIterations, [event.edgeKey]: event.iteration },
        updatedAt: event.timestamp,
      };
    }
    case "CHECKPOINT_RECORDED": {
      const run = requireState(state, event);
      return { ...run, checkpoints: run.checkpoints + 1, updatedAt: event.timestamp };
    }
    case "RUN_SUCCEEDED": {
      const run = requireState(state, event);
      return { ...run, status: "succeeded", updatedAt: event.timestamp };
    }
    case "RUN_FAILED": {
      const run = requireState(state, event);
      return { ...run, status: "failed", failureReason: event.reason, updatedAt: event.timestamp };
    }
    case "RUN_CANCELLED": {
      const run = requireState(state, event);
      return { ...run, status: "cancelled", failureReason: event.reason, updatedAt: event.timestamp };
    }
  }
}

function requireState(state: WorkflowRunState | null, event: WorkflowRunEvent): WorkflowRunState {
  if (!state) throw new Error(`event ${event.type} for run ${(event as { runId?: string }).runId} without RUN_STARTED`);
  return state;
}

// -----------------------------------------------------------------------------
// Merge queue: single-writer lease per exclusive resource, CAS-admitted.
// -----------------------------------------------------------------------------

export type MergeQueueEvent =
  | { type: "MERGE_ADMITTED"; resource: string; runId: string; nodeId: string; leaseExpiry: number; timestamp: number }
  | { type: "MERGE_RELEASED"; resource: string; runId: string; nodeId: string; timestamp: number };

export interface MergeHolder {
  runId: string;
  nodeId: string;
  leaseExpiry: number;
}

/**
 * Per-resource single-writer admission. A lease is one append on the
 * resource's stream guarded by CAS on the revision, so exactly one contender
 * wins. Crash recovery is lease expiry: a crashed holder's lease ages out and
 * the next contender is admitted.
 */
export class MergeQueue {
  private repo: IAppendOnlyRepository<MergeQueueEvent, unknown>;

  constructor(repo?: IAppendOnlyRepository<MergeQueueEvent, unknown>) {
    this.repo = repo ?? new JsonlStorageRepository<MergeQueueEvent, unknown>("workflow-merge-queue");
  }

  public holder(resource: string): MergeHolder | null {
    let holder: MergeHolder | null = null;
    for (const event of this.repo.readEvents(`merge-${resource}`)) {
      holder = event.type === "MERGE_ADMITTED"
        ? { runId: event.runId, nodeId: event.nodeId, leaseExpiry: event.leaseExpiry }
        : null;
    }
    return holder;
  }

  public acquire(resource: string, runId: string, nodeId: string, leaseMs: number, now = Date.now()): boolean {
    const stream = `merge-${resource}`;
    const events = this.repo.readEvents(stream);
    let holder: MergeHolder | null = null;
    for (const event of events) {
      holder = event.type === "MERGE_ADMITTED"
        ? { runId: event.runId, nodeId: event.nodeId, leaseExpiry: event.leaseExpiry }
        : null;
    }
    if (holder && holder.leaseExpiry > now && (holder.runId !== runId || holder.nodeId !== nodeId)) {
      return false;
    }
    try {
      this.repo.append(stream, { type: "MERGE_ADMITTED", resource, runId, nodeId, leaseExpiry: now + leaseMs, timestamp: now }, events.length);
      return true;
    } catch (err) {
      if (err instanceof StorageError && err.code === "CONCURRENCY_CONFLICT") return false;
      throw err;
    }
  }

  public release(resource: string, runId: string, nodeId: string, now = Date.now()): void {
    const stream = `merge-${resource}`;
    const events = this.repo.readEvents(stream);
    let holder: MergeHolder | null = null;
    for (const event of events) {
      holder = event.type === "MERGE_ADMITTED"
        ? { runId: event.runId, nodeId: event.nodeId, leaseExpiry: event.leaseExpiry }
        : null;
    }
    if (!holder || holder.runId !== runId || holder.nodeId !== nodeId) return;
    this.repo.append(stream, { type: "MERGE_RELEASED", resource, runId, nodeId, timestamp: now }, events.length);
  }
}

// -----------------------------------------------------------------------------
// Runner: bounded loops, budget, retry/fallback, checkpoints, cancellation,
// merge-queue admission, crash-resume.
// -----------------------------------------------------------------------------

export interface WorkflowNodeContext {
  runId: string;
  parentTaskId: string;
  nodeId: string;
  occurrence: number;
  attempt: number;
  /** Output keys of previously completed nodes in this run (for `when` routing). */
  outputs: Readonly<Record<string, Record<string, unknown>>>;
}

export type WorkflowNodeExecutor = (
  node: WorkflowGraphNode,
  ctx: WorkflowNodeContext,
) => Promise<Record<string, unknown> | void>;

export interface WorkflowRunnerOptions {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Poll cadence while waiting on a held merge resource. */
  mergePollMs?: number;
}

const RUN_FAILURE_BUDGET = "budget_exhausted";
const RUN_FAILURE_LOOP = "loop_bound_exceeded";

export class WorkflowGraphRunner {
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly mergePollMs: number;

  constructor(
    private readonly store: WorkflowRunStore,
    private readonly mergeQueue: MergeQueue,
    private readonly executor: WorkflowNodeExecutor,
    options: WorkflowRunnerOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.mergePollMs = options.mergePollMs ?? 25;
  }

  /**
   * Opens a run under the parent Task and drives it to a terminal state.
   * Re-invoking with an identical RUN_STARTED (same parentTaskId + graphHash)
   * resumes instead of double-opening — merge/replay safe.
   */
  public async run(graph: WorkflowGraph, runId: string, parentTaskId: string): Promise<WorkflowRunState> {
    const verdict = validateWorkflowGraph(graph);
    if (!verdict.ok) throw new Error(`workflow graph invalid: ${verdict.errors.join("; ")}`);
    if (!RUN_ID_PATTERN.test(runId)) throw new Error(`runId invalid: ${runId}`);
    const graphHash = hashWorkflowGraph(graph);
    const existing = this.store.read(runId);
    if (existing) {
      const { state } = existing;
      if (state.parentTaskId !== parentTaskId || state.graphHash !== graphHash) {
        throw new Error(`run ${runId} exists under a different parent task or graph`);
      }
      return this.resume(graph, runId);
    }
    this.store.append(runId, {
      type: "RUN_STARTED",
      runId,
      parentTaskId,
      graphHash,
      budget: { ...graph.policies.budget },
      timestamp: this.now(),
    });
    this.store.append(runId, { type: "NODE_SCHEDULED", runId, nodeId: graph.startNodeId, occurrence: 1, viaLoopEdge: false, timestamp: this.now() });
    return this.drive(graph, runId);
  }

  /**
   * Crash-resume: rebuilds state by replaying the event log, orphans any
   * attempt left in-flight by the crash, and continues. Attempts recorded as
   * succeeded are never re-executed.
   */
  public async resume(graph: WorkflowGraph, runId: string): Promise<WorkflowRunState> {
    const existing = this.store.read(runId);
    if (!existing) throw new Error(`run ${runId} does not exist`);
    const graphHash = hashWorkflowGraph(graph);
    if (existing.state.graphHash !== graphHash) {
      throw new Error(`run ${runId} belongs to graph ${existing.state.graphHash}, not ${graphHash}`);
    }
    const { state } = existing;
    if (TERMINAL_STATUSES.has(state.status)) return state;
    for (const [nodeId, node] of Object.entries(state.nodes)) {
      if (node.status === "running") {
        this.store.append(runId, { type: "ATTEMPT_ORPHANED", runId, nodeId, occurrence: node.occurrence, attempt: node.attempt, timestamp: this.now() });
      }
    }
    return this.drive(graph, runId);
  }

  /** Fences the run: appends RUN_CANCELLED; all later run writes are rejected. */
  public cancel(runId: string, reason?: string): void {
    const existing = this.store.read(runId);
    if (!existing) throw new Error(`run ${runId} does not exist`);
    if (TERMINAL_STATUSES.has(existing.state.status)) return;
    this.store.append(runId, { type: "RUN_CANCELLED", runId, reason, timestamp: this.now() });
  }

  private nodeById(graph: WorkflowGraph): Map<string, WorkflowGraphNode> {
    return new Map(graph.nodes.map((node) => [node.id, node]));
  }

  private async drive(graph: WorkflowGraph, runId: string): Promise<WorkflowRunState> {
    const nodes = this.nodeById(graph);
    const outputs: Record<string, Record<string, unknown>> = {};
    let completedSinceCheckpoint = 0;

    for (;;) {
      let state = this.store.read(runId)!.state;
      if (TERMINAL_STATUSES.has(state.status)) return state;

      // Budget guards (attempt budget is also checked per start below).
      if (this.now() - state.startedAt > state.budget.maxDurationMs) {
        return this.failRun(runId, RUN_FAILURE_BUDGET);
      }

      const pending = Object.entries(state.nodes).find(([, n]) => n.status === "scheduled");
      const retryWait = Object.entries(state.nodes)
        .filter(([, n]) => n.status === "retry-wait")
        .sort((a, b) => (a[1].nextEligibleTime ?? 0) - (b[1].nextEligibleTime ?? 0))[0];

      if (!pending && !retryWait) {
        try {
          return this.store.append(runId, { type: "RUN_SUCCEEDED", runId, timestamp: this.now() });
        } catch (err) {
          // Cancel beat the completion append; the cancelled state is authoritative.
          if (err instanceof WorkflowFenceError) return this.store.read(runId)!.state;
          throw err;
        }
      }

      let nodeId: string;
      if (pending) {
        [nodeId] = pending;
      } else {
        const [retryNodeId, retryState] = retryWait;
        const waitMs = Math.max(0, (retryState.nextEligibleTime ?? 0) - this.now());
        if (waitMs > 0) await this.sleep(waitMs);
        state = this.store.read(runId)!.state;
        if (TERMINAL_STATUSES.has(state.status)) return state;
        nodeId = retryNodeId;
      }

      const node = nodes.get(nodeId)!;
      const occurrence = state.nodes[nodeId].occurrence;
      const attempt = state.nodes[nodeId].attempt + 1;

      if (state.attemptsUsed >= state.budget.maxNodeAttempts) {
        return this.failRun(runId, RUN_FAILURE_BUDGET);
      }

      // Merge-queue admission for exclusive resources (single writer).
      const resources = node.resources ?? [];
      const admitted: string[] = [];
      for (const resource of resources) {
        while (!this.mergeQueue.acquire(resource, runId, nodeId, graph.policies.mergeQueue.leaseMs, this.now())) {
          await this.sleep(this.mergePollMs);
          const fresh = this.store.read(runId)!.state;
          if (TERMINAL_STATUSES.has(fresh.status)) return fresh;
          if (this.now() - fresh.startedAt > fresh.budget.maxDurationMs) {
            return this.failRun(runId, RUN_FAILURE_BUDGET);
          }
        }
        admitted.push(resource);
      }

      this.store.append(runId, { type: "ATTEMPT_STARTED", runId, nodeId, occurrence, attempt, timestamp: this.now() });

      const retry = node.retry ?? graph.policies.retry;
      try {
        const output = await this.executor(node, { runId, parentTaskId: state.parentTaskId, nodeId, occurrence, attempt, outputs });
        const safeOutput = output ?? {};
        this.store.append(runId, {
          type: "ATTEMPT_SUCCEEDED",
          runId,
          nodeId,
          occurrence,
          attempt,
          outputHash: createHash("sha256").update(canonicalJson(safeOutput), "utf8").digest("hex"),
          timestamp: this.now(),
        });
        outputs[nodeId] = safeOutput;
        for (const resource of admitted) this.mergeQueue.release(resource, runId, nodeId, this.now());

        completedSinceCheckpoint += 1;
        if (completedSinceCheckpoint >= graph.policies.checkpoint.everyNCompletedNodes) {
          this.store.append(runId, { type: "CHECKPOINT_RECORDED", runId, completedAttempts: this.store.read(runId)!.state.attemptsUsed, timestamp: this.now() });
          completedSinceCheckpoint = 0;
        }

        this.routeSuccessors(graph, runId, nodeId, safeOutput);
      } catch (err) {
        // A fenced append means the run was cancelled mid-attempt: the result
        // is discarded, no post-cancel write lands, and resources age out by
        // lease expiry. Release is a merge-stream write, not a fenced run write.
        if (err instanceof WorkflowFenceError) {
          for (const resource of admitted) {
            try { this.mergeQueue.release(resource, runId, nodeId, this.now()); } catch { /* fenced or lost race */ }
          }
          return this.store.read(runId)!.state;
        }
        for (const resource of admitted) this.mergeQueue.release(resource, runId, nodeId, this.now());

        const errorClass = err instanceof Error ? err.name : "Error";
        const errorMessage = err instanceof Error ? err.message : String(err);
        if (attempt < retry.maxAttempts) {
          this.store.append(runId, {
            type: "ATTEMPT_FAILED",
            runId,
            nodeId,
            occurrence,
            attempt,
            errorClass,
            errorMessage,
            nextEligibleTime: this.now() + retry.delayMs,
            timestamp: this.now(),
          });
        } else {
          this.store.append(runId, { type: "ATTEMPT_FAILED", runId, nodeId, occurrence, attempt, errorClass, errorMessage, timestamp: this.now() });
          if (retry.fallbackNodeId) {
            const target = this.store.read(runId)!.state.nodes[retry.fallbackNodeId];
            // A fresh occurrence so a fallback can fire even if its target ran earlier.
            this.store.append(runId, { type: "NODE_SCHEDULED", runId, nodeId: retry.fallbackNodeId, occurrence: (target?.occurrence ?? 0) + 1, viaLoopEdge: false, timestamp: this.now() });
          } else {
            return this.failRun(runId, `node_failed:${nodeId}`);
          }
        }
      }
    }
  }

  private routeSuccessors(graph: WorkflowGraph, runId: string, nodeId: string, output: Record<string, unknown>): void {
    const edges = graph.edges
      .filter((edge) => edge.from === nodeId && (edge.when === undefined || Boolean(output[edge.when])))
      .sort((a, b) => (a.to < b.to ? -1 : a.to > b.to ? 1 : 0));
    const state = this.store.read(runId)!.state;
    for (const edge of edges) {
      if (edge.loop) {
        const edgeKey = `${edge.from}->${edge.to}`;
        const iteration = state.loopIterations[edgeKey] ?? 0;
        if (iteration >= edge.loop.maxIterations) {
          this.failRun(runId, `${RUN_FAILURE_LOOP}:${edgeKey}`);
          return;
        }
        this.store.append(runId, { type: "LOOP_ITERATION", runId, edgeKey, iteration: iteration + 1, timestamp: this.now() });
        const target = this.store.read(runId)!.state.nodes[edge.to];
        this.store.append(runId, {
          type: "NODE_SCHEDULED",
          runId,
          nodeId: edge.to,
          occurrence: (target?.occurrence ?? 0) + 1,
          viaLoopEdge: true,
          timestamp: this.now(),
        });
      } else {
        const target = this.store.read(runId)!.state.nodes[edge.to];
        // Idempotent schedule: never re-fire a live or succeeded occurrence via
        // a forward edge (dedupe on replay/join); loops above are the only
        // re-entry path and they are bounded.
        if (target && target.status !== "failed") continue;
        this.store.append(runId, { type: "NODE_SCHEDULED", runId, nodeId: edge.to, occurrence: 1, viaLoopEdge: false, timestamp: this.now() });
      }
    }
  }

  /** Cancel wins over a concurrent completion: fence throws become the current state. */
  private failRun(runId: string, reason: string): WorkflowRunState {
    try {
      return this.store.append(runId, { type: "RUN_FAILED", runId, reason, timestamp: this.now() });
    } catch (err) {
      if (err instanceof WorkflowFenceError) return this.store.read(runId)!.state;
      throw err;
    }
  }
}
