import assert from "node:assert/strict";
import test from "node:test";

import { JobQueue } from "../llmops/jobs";
import { IAppendOnlyRepository, StorageError } from "../llmops/storage";
import {
  MergeQueue,
  MergeQueueEvent,
  S09_GRAPH_LIMITS,
  WorkflowFenceError,
  WorkflowGraph,
  WorkflowGraphNode,
  WorkflowGraphPolicies,
  WorkflowRunEvent,
  WorkflowRunState,
  WorkflowRunStore,
  compileWorkflowGraph,
  hashWorkflowGraph,
  validateWorkflowGraph,
  WorkflowGraphRunner,
} from "../llmops/workflow";

class MemRepo<E> implements IAppendOnlyRepository<E, unknown> {
  private streams = new Map<string, E[]>();

  append(streamId: string, event: E, expectedRevision?: number): void {
    const events = this.streams.get(streamId) ?? [];
    if (expectedRevision !== undefined && events.length !== expectedRevision) {
      throw new StorageError("stream revision changed", "CONCURRENCY_CONFLICT");
    }
    events.push(event);
    this.streams.set(streamId, events);
  }

  readEvents(streamId: string): E[] {
    return [...(this.streams.get(streamId) ?? [])];
  }

  listStreams(): string[] {
    return [...this.streams.keys()].sort();
  }
}

function basePolicies(overrides: Partial<WorkflowGraphPolicies> = {}): WorkflowGraphPolicies {
  return {
    budget: { maxNodeAttempts: 100, maxDurationMs: 60_000 },
    cancellation: { fenceOnCancel: true },
    checkpoint: { everyNCompletedNodes: 1 },
    retry: { maxAttempts: 1, delayMs: 0 },
    mergeQueue: { exclusiveResources: [], leaseMs: 1_000 },
    ...overrides,
  };
}

function node(id: string, extra: Partial<WorkflowGraphNode> = {}): WorkflowGraphNode {
  return { id, type: "tool", action: "noop", ...extra };
}

function chainGraph(ids: string[], extra: Partial<WorkflowGraph> = {}): WorkflowGraph {
  return {
    schemaVersion: 1,
    graphId: "g-chain",
    startNodeId: ids[0],
    nodes: ids.map((id) => node(id)),
    edges: ids.slice(1).map((to, i) => ({ from: ids[i], to })),
    policies: basePolicies(),
    ...extra,
  };
}

function makeRunner(
  executor: (node: WorkflowGraphNode, ctx: { attempt: number; occurrence: number }) => Promise<Record<string, unknown> | void>,
  repos?: { runRepo?: MemRepo<WorkflowRunEvent>; mergeRepo?: MemRepo<MergeQueueEvent> },
) {
  const store = new WorkflowRunStore(repos?.runRepo ?? new MemRepo<WorkflowRunEvent>());
  const queue = new MergeQueue(repos?.mergeRepo ?? new MemRepo<MergeQueueEvent>());
  const runner = new WorkflowGraphRunner(store, queue, executor, { mergePollMs: 2 });
  return { store, queue, runner };
}

// ---------------------------------------------------------------------------
// Graph bounds (contract: depth 32 / nodes 128 / loop iterations 100).
// ---------------------------------------------------------------------------

test("validation: node count bound 128", () => {
  // Isolated nodes (depth 1) so only the count bound is exercised.
  const wide = (count: number): WorkflowGraph => ({
    schemaVersion: 1,
    graphId: "g-wide",
    startNodeId: "n0",
    nodes: Array.from({ length: count }, (_, i) => node(`n${i}`)),
    edges: [],
    policies: basePolicies(),
  });
  const verdict = validateWorkflowGraph(wide(S09_GRAPH_LIMITS.maxNodes + 1));
  assert.equal(verdict.ok, false);
  assert.ok(verdict.errors.some((e) => e.includes("max nodes 128")));
  assert.equal(validateWorkflowGraph(wide(S09_GRAPH_LIMITS.maxNodes)).ok, true);
});

test("validation: depth bound 32", () => {
  const ids = Array.from({ length: S09_GRAPH_LIMITS.maxDepth + 1 }, (_, i) => `d${i}`);
  const verdict = validateWorkflowGraph(chainGraph(ids));
  assert.equal(verdict.ok, false);
  assert.ok(verdict.errors.some((e) => e.includes(`max depth ${S09_GRAPH_LIMITS.maxDepth}`)));
  assert.equal(validateWorkflowGraph(chainGraph(ids.slice(0, S09_GRAPH_LIMITS.maxDepth))).ok, true);
});

test("validation: loop iteration bound 100 and cycles must be bounded", () => {
  const base = chainGraph(["a", "b"]);
  const overBound: WorkflowGraph = {
    ...base,
    edges: [...base.edges, { from: "b", to: "a", loop: { maxIterations: S09_GRAPH_LIMITS.maxLoopIterations + 1 } }],
  };
  const over = validateWorkflowGraph(overBound);
  assert.equal(over.ok, false);
  assert.ok(over.errors.some((e) => e.includes("max iterations 100")));

  const atBound: WorkflowGraph = {
    ...base,
    edges: [...base.edges, { from: "b", to: "a", loop: { maxIterations: S09_GRAPH_LIMITS.maxLoopIterations } }],
  };
  assert.equal(validateWorkflowGraph(atBound).ok, true);

  const unbounded: WorkflowGraph = { ...base, edges: [...base.edges, { from: "b", to: "a" }] };
  const cycle = validateWorkflowGraph(unbounded);
  assert.equal(cycle.ok, false);
  assert.ok(cycle.errors.some((e) => e.includes("unbounded cycle")));
});

test("validation: typing, references, policies, and hash pin fail closed", () => {
  const good = chainGraph(["a", "b"]);
  assert.equal(validateWorkflowGraph(good).ok, true);

  const badType = chainGraph(["a"], {});
  (badType.nodes[0] as { type: string }).type = "shell";
  assert.ok(validateWorkflowGraph(badType).errors.some((e) => e.includes("unknown type")));

  const dup = chainGraph(["a"]);
  dup.nodes.push(node("a"));
  assert.ok(validateWorkflowGraph(dup).errors.some((e) => e.includes("duplicate node id")));

  const badEdge = chainGraph(["a"]);
  badEdge.edges.push({ from: "a", to: "ghost" });
  assert.ok(validateWorkflowGraph(badEdge).errors.some((e) => e.includes("unknown node")));

  const noFence = chainGraph(["a"], { policies: basePolicies({ cancellation: { fenceOnCancel: false } }) });
  assert.ok(validateWorkflowGraph(noFence).errors.some((e) => e.includes("fenceOnCancel must be true")));

  const badFallback = chainGraph(["a"]);
  badFallback.nodes[0].retry = { maxAttempts: 1, delayMs: 0, fallbackNodeId: "ghost" };
  assert.ok(validateWorkflowGraph(badFallback).errors.some((e) => e.includes("fallbackNodeId references unknown node")));

  const badResource = chainGraph(["a"]);
  badResource.nodes[0].resources = ["worktree"];
  assert.ok(validateWorkflowGraph(badResource).errors.some((e) => e.includes("undeclared merge-queue resource")));

  const drifted: WorkflowGraph = { ...good, graphHash: "0".repeat(64) };
  assert.ok(validateWorkflowGraph(drifted).errors.some((e) => e.includes("graphHash does not match")));
  const pinned: WorkflowGraph = { ...good, graphHash: hashWorkflowGraph(good) };
  assert.equal(validateWorkflowGraph(pinned).ok, true);
});

test("determinism: graph hash is key-order independent; compilation is stable and idempotent", () => {
  const graph = chainGraph(["a", "b", "c"]);
  const reordered = {
    policies: graph.policies,
    edges: graph.edges,
    nodes: graph.nodes,
    startNodeId: graph.startNodeId,
    graphId: graph.graphId,
    schemaVersion: 1 as const,
  };
  assert.equal(hashWorkflowGraph(graph), hashWorkflowGraph(reordered));

  const jobRepo = new MemRepo<import("../llmops/jobs").JobEvent>();
  const queue = new JobQueue(jobRepo);
  const first = compileWorkflowGraph(graph, queue, "task-1");
  const second = compileWorkflowGraph(graph, queue, "task-1");
  assert.equal(first.graphHash, second.graphHash);
  assert.deepEqual(first.plan, second.plan);
  // Idempotent replay: exactly one job stream per node, no duplicates.
  assert.equal(jobRepo.listStreams().length, 3);
  assert.deepEqual(first.plan.map((p) => p.nodeId), ["a", "b", "c"]);

  const invalid = chainGraph(["a"]);
  (invalid.nodes[0] as { type: string }).type = "shell";
  assert.throws(() => compileWorkflowGraph(invalid, queue, "task-1"), /workflow graph invalid/);
});

// ---------------------------------------------------------------------------
// Runtime: parent Task authority, durable child Attempts, checkpoints, loops,
// retry/fallback, budget.
// ---------------------------------------------------------------------------

test("happy path: run succeeds under parent task with checkpoint and audit trail", async () => {
  const graph = chainGraph(["a", "b"]);
  const { store, runner } = makeRunner(async () => ({ ok: true }));
  const state = await runner.run(graph, "run-happy", "task-parent");
  assert.equal(state.status, "succeeded");
  assert.equal(state.parentTaskId, "task-parent");
  assert.equal(state.graphHash, hashWorkflowGraph(graph));

  const started = store.rawEvents("run-happy").find((e) => e.type === "RUN_STARTED");
  assert.equal(started?.type === "RUN_STARTED" && started.parentTaskId, "task-parent");
  assert.ok(store.rawEvents("run-happy").some((e) => e.type === "CHECKPOINT_RECORDED"));

  const transitions = state.audit.map((a) => `${a.nodeId}:${a.transition}`);
  assert.deepEqual(transitions, ["a:started", "a:succeeded", "b:started", "b:succeeded"]);
});

test("bounded loop: exits on condition, fails closed at iteration bound", async () => {
  const graph: WorkflowGraph = {
    schemaVersion: 1,
    graphId: "g-loop",
    startNodeId: "poll",
    nodes: [node("poll"), node("finish")],
    edges: [
      { from: "poll", to: "poll", when: "again", loop: { maxIterations: 3 } },
      { from: "poll", to: "finish", when: "finished" },
    ],
    policies: basePolicies(),
  };

  let calls = 0;
  const exiting = makeRunner(async (n) => {
    if (n.id !== "poll") return { done: true };
    calls += 1;
    return calls < 2 ? { again: true } : { finished: true };
  });
  const state = await exiting.runner.run(graph, "run-loop-ok", "task-1");
  assert.equal(state.status, "succeeded");
  assert.equal(calls, 2);
  assert.equal(state.loopIterations["poll->poll"], 1);

  const stuck = makeRunner(async (n) => (n.id === "poll" ? { again: true } : {}));
  const failed = await stuck.runner.run(graph, "run-loop-stuck", "task-1");
  assert.equal(failed.status, "failed");
  assert.match(failed.failureReason ?? "", /loop_bound_exceeded/);
  assert.equal(failed.loopIterations["poll->poll"], 3);
  const pollSuccesses = failed.audit.filter((a) => a.nodeId === "poll" && a.transition === "succeeded");
  assert.equal(pollSuccesses.length, 4); // initial + 3 bounded iterations, then fenced
});

test("retry then success, and fallback after exhausted retries", async () => {
  const flakyGraph: WorkflowGraph = {
    schemaVersion: 1,
    graphId: "g-flaky",
    startNodeId: "flaky",
    nodes: [node("flaky", { retry: { maxAttempts: 2, delayMs: 0 } }), node("after")],
    edges: [{ from: "flaky", to: "after" }],
    policies: basePolicies(),
  };
  let attempts = 0;
  const flaky = makeRunner(async (n) => {
    if (n.id !== "flaky") return {};
    attempts += 1;
    if (attempts === 1) throw new Error("transient");
    return { ok: true };
  });
  const recovered = await flaky.runner.run(flakyGraph, "run-retry", "task-1");
  assert.equal(recovered.status, "succeeded");
  const flakyAudit = recovered.audit.filter((a) => a.nodeId === "flaky").map((a) => a.transition);
  assert.deepEqual(flakyAudit, ["started", "failed", "started", "succeeded"]);

  const fallbackGraph: WorkflowGraph = {
    schemaVersion: 1,
    graphId: "g-fallback",
    startNodeId: "primary",
    nodes: [
      node("primary", { retry: { maxAttempts: 1, delayMs: 0, fallbackNodeId: "backup" } }),
      node("backup"),
    ],
    edges: [],
    policies: basePolicies(),
  };
  const fallback = makeRunner(async (n) => {
    if (n.id === "primary") throw new Error("permanent");
    return { rescued: true };
  });
  const rescued = await fallback.runner.run(fallbackGraph, "run-fallback", "task-1");
  assert.equal(rescued.status, "succeeded");
  const audit = rescued.audit.map((a) => `${a.nodeId}:${a.transition}`);
  assert.deepEqual(audit, ["primary:started", "primary:failed", "backup:started", "backup:succeeded"]);
});

test("budget: attempt budget exhaustion fails the run and fences retries", async () => {
  const graph: WorkflowGraph = {
    schemaVersion: 1,
    graphId: "g-budget",
    startNodeId: "spendy",
    nodes: [node("spendy", { retry: { maxAttempts: 5, delayMs: 0 } })],
    edges: [],
    policies: basePolicies({ budget: { maxNodeAttempts: 1, maxDurationMs: 60_000 } }),
  };
  const { runner } = makeRunner(async () => {
    throw new Error("always fails");
  });
  const state = await runner.run(graph, "run-budget", "task-1");
  assert.equal(state.status, "failed");
  assert.match(state.failureReason ?? "", /budget_exhausted/);
  assert.equal(state.attemptsUsed, 1);
});

// ---------------------------------------------------------------------------
// Crash-resume and merge safety (contract gate: crash_resume_merge_safety).
// ---------------------------------------------------------------------------

test("crash-resume: replay rebuilds state, in-flight orphaned, succeeded never re-run", async () => {
  const graph = chainGraph(["a", "b"]);
  const runRepo = new MemRepo<WorkflowRunEvent>();

  // Simulate a crash: power loss after b's attempt started. The durable log is
  // exactly what a crashed process would leave behind.
  const crashStore = new WorkflowRunStore(runRepo);
  const t0 = Date.now(); // wall-clock: resume's duration budget is measured against real now
  crashStore.append("run-crash", { type: "RUN_STARTED", runId: "run-crash", parentTaskId: "task-parent", graphHash: hashWorkflowGraph(graph), budget: { maxNodeAttempts: 100, maxDurationMs: 60_000 }, timestamp: t0 });
  crashStore.append("run-crash", { type: "NODE_SCHEDULED", runId: "run-crash", nodeId: "a", occurrence: 1, viaLoopEdge: false, timestamp: t0 + 1 });
  crashStore.append("run-crash", { type: "ATTEMPT_STARTED", runId: "run-crash", nodeId: "a", occurrence: 1, attempt: 1, timestamp: t0 + 2 });
  crashStore.append("run-crash", { type: "ATTEMPT_SUCCEEDED", runId: "run-crash", nodeId: "a", occurrence: 1, attempt: 1, outputHash: "h-a", timestamp: t0 + 3 });
  crashStore.append("run-crash", { type: "NODE_SCHEDULED", runId: "run-crash", nodeId: "b", occurrence: 1, viaLoopEdge: false, timestamp: t0 + 4 });
  crashStore.append("run-crash", { type: "ATTEMPT_STARTED", runId: "run-crash", nodeId: "b", occurrence: 1, attempt: 1, timestamp: t0 + 5 });

  // New process: fresh runner over the same durable log.
  const executions: string[] = [];
  const { runner, store } = makeRunner(async (n) => {
    executions.push(n.id);
    return { ok: true };
  }, { runRepo });

  const state = await runner.resume(graph, "run-crash");
  assert.equal(state.status, "succeeded");
  assert.deepEqual(executions, ["b"]); // a never re-executed
  const transitions = state.audit.map((a) => `${a.nodeId}:${a.transition}`);
  assert.deepEqual(transitions, [
    "a:started", "a:succeeded",
    "b:started", "b:orphaned", // crash left b in-flight; resume fences it
    "b:started", "b:succeeded",
  ]);

  // Idempotent replay: run() with identical authority resumes instead of reopening.
  const replayed = await runner.run(graph, "run-crash", "task-parent");
  assert.equal(replayed.status, "succeeded");
  assert.deepEqual(executions, ["b"]);

  // Conflicting authority under the same run id fails closed.
  await assert.rejects(() => runner.run(graph, "run-crash", "task-other"), /different parent task or graph/);
  await assert.rejects(() => runner.resume(chainGraph(["a", "b", "c"]), "run-crash"), /belongs to graph/);

  const finalRead: WorkflowRunState | null = store.read("run-crash")?.state ?? null;
  assert.equal(finalRead?.parentTaskId, "task-parent");
});

test("cancellation fences child attempts: no post-cancel writes land", async () => {
  const graph = chainGraph(["a", "b"]);
  let releaseA = false;
  let aStarted = false;
  const { store, runner } = makeRunner(async (n) => {
    if (n.id !== "a") return {};
    aStarted = true;
    while (!releaseA) await new Promise((resolve) => setTimeout(resolve, 1));
    return { late: true };
  });

  const runPromise = runner.run(graph, "run-cancel", "task-parent");
  while (!aStarted) await new Promise((resolve) => setTimeout(resolve, 1));
  runner.cancel("run-cancel", "operator stop");
  releaseA = true;

  const state = await runPromise;
  assert.equal(state.status, "cancelled");

  const events = store.rawEvents("run-cancel");
  const cancelIndex = events.findIndex((e) => e.type === "RUN_CANCELLED");
  assert.ok(cancelIndex > 0);
  // No attempt outcome was written after the cancel fence.
  assert.equal(events.slice(cancelIndex + 1).some((e) => e.type.startsWith("ATTEMPT_")), false);
  assert.equal(state.audit.some((a) => a.transition === "succeeded"), false);

  // The fence is durable: direct post-cancel writes are rejected too.
  assert.throws(
    () => store.append("run-cancel", { type: "ATTEMPT_SUCCEEDED", runId: "run-cancel", nodeId: "a", occurrence: 1, attempt: 1, outputHash: "h", timestamp: 0 }),
    WorkflowFenceError,
  );
});

test("merge queue: single-writer admission, lease expiry recovery, no overlap", async () => {
  const queue = new MergeQueue(new MemRepo<MergeQueueEvent>());
  assert.equal(queue.acquire("worktree", "run-1", "m", 50, 1_000), true);
  assert.equal(queue.acquire("worktree", "run-2", "m", 50, 1_001), false); // held
  assert.equal(queue.acquire("worktree", "run-1", "m", 50, 1_001), true); // self re-entry ok
  // Crash of run-1 without release: lease expiry admits the next contender.
  assert.equal(queue.acquire("worktree", "run-2", "m", 50, 1_052), true);
  queue.release("worktree", "run-2", "m", 1_060);
  assert.equal(queue.holder("worktree"), null);
  queue.release("worktree", "run-9", "m", 1_061); // non-holder release is a no-op
  assert.equal(queue.holder("worktree"), null);

  // End-to-end: two runs, one exclusive resource, strictly serialized.
  const graph: WorkflowGraph = {
    schemaVersion: 1,
    graphId: "g-merge",
    startNodeId: "merge-node",
    nodes: [node("merge-node", { resources: ["worktree"] })],
    edges: [],
    policies: basePolicies({ mergeQueue: { exclusiveResources: ["worktree"], leaseMs: 5_000 } }),
  };
  const runRepo = new MemRepo<WorkflowRunEvent>();
  const mergeRepo = new MemRepo<MergeQueueEvent>();
  const order: string[] = [];
  const makeExec = (tag: string, holdMs: number) => async () => {
    order.push(`${tag}:enter`);
    await new Promise((resolve) => setTimeout(resolve, holdMs));
    order.push(`${tag}:exit`);
    return {};
  };
  const first = makeRunner(makeExec("r1", 30), { runRepo, mergeRepo });
  const second = makeRunner(makeExec("r2", 1), { runRepo, mergeRepo });
  const [s1, s2] = await Promise.all([
    first.runner.run(graph, "run-merge-1", "task-1"),
    second.runner.run(graph, "run-merge-2", "task-2"),
  ]);
  assert.equal(s1.status, "succeeded");
  assert.equal(s2.status, "succeeded");
  assert.deepEqual(order, ["r1:enter", "r1:exit", "r2:enter", "r2:exit"]);
});
