import type { RunState } from "../agentRuntime/state";
import type { AutomationRun } from "../automations";
import type { ChatResult } from "../builders/chat";
import type { KanbanAttempt, WorkItem } from "../agent-kanban/types";
import {
  RUN_ENVELOPE_SCHEMA_VERSION,
  type RunEnvelope,
  type RunStatus,
  type UsageTotals,
} from "./contracts";
import { REDACTED_LOCAL_VALUE } from "./redaction";

export type LegacyKind = "agent-run" | "automation-run" | "builder-chat" | "kanban-work-item";

export interface ProducerInventoryEntry {
  producer: string;
  sourceKind: RunEnvelope["sourceRef"]["kind"];
  ownerModule: string;
  stateFile: string;
  processOwner: string;
  abortPath: string;
  restartBehavior: string;
  hasBuilderSession: boolean;
  hasBuilderId: boolean;
  hasKanbanAttempt: boolean;
}

export const PRODUCER_INVENTORY: ProducerInventoryEntry[] = [
  {
    producer: "FirstMate/Sen Agent runtime",
    sourceKind: "agent",
    ownerModule: "source/src/lib/agentRuntime/state.ts",
    stateFile: "runtime/runs/<run-id>.json",
    processOwner: "agentRuntime runner",
    abortPath: "policy/tool approval and runner cancellation",
    restartBehavior: "FileStateStore reloads RunState by run id and revision",
    hasBuilderSession: false,
    hasBuilderId: false,
    hasKanbanAttempt: false,
  },
  {
    producer: "Automation scheduler",
    sourceKind: "automation",
    ownerModule: "source/src/lib/automations.ts",
    stateFile: "automations/runs/<run-id>.json",
    processOwner: "automation scheduler/in-flight map",
    abortPath: "automation cap/overlap guard; runtime run id for router brains",
    restartBehavior: "run records are durable; in-flight process ownership is scheduler-local",
    hasBuilderSession: false,
    hasBuilderId: false,
    hasKanbanAttempt: false,
  },
  {
    producer: "Sen chat",
    sourceKind: "chat",
    ownerModule: "source/src/app/api/firstmate/chat/route.ts",
    stateFile: "agents/firstmate/sessions.json + agents/firstmate-<session-id>/chat.jsonl",
    processOwner: "FirstMate chat route via ACP lane or runBuilderChat child process",
    abortPath: "request AbortSignal plus lane/process cancellation",
    restartBehavior: "session metadata preserves the real Builder session id; a single turn is not replayed",
    hasBuilderSession: true,
    hasBuilderId: true,
    hasKanbanAttempt: false,
  },
  {
    producer: "Agent Kanban",
    sourceKind: "kanban",
    ownerModule: "source/src/lib/agent-kanban/store.ts + source/src/lib/agent-kanban/executor.ts",
    stateFile: "agent-kanban/cards.json + events.jsonl + commands/<attempt-id>.jsonl",
    processOwner: "KanbanStore/KanbanExecutor/KanbanEventBus",
    abortPath: "registered execution/attempt handle",
    restartBehavior: "snapshot lastAppliedSeq plus event-log replay tail",
    hasBuilderSession: true,
    hasBuilderId: true,
    hasKanbanAttempt: true,
  },
  {
    producer: "Delegation",
    sourceKind: "delegation",
    ownerModule: "source/src/lib/agentRuntime/toolkits/delegate.ts",
    stateFile: "parent RunState steps; no independent durable child-run file",
    processOwner: "delegate_task tool via runBuilderChat",
    abortPath: "parent runtime signal and runBuilderChat process cancellation",
    restartBehavior: "completed tool output survives in parent RunState; an interrupted delegate is not resumed",
    hasBuilderSession: false,
    hasBuilderId: true,
    hasKanbanAttempt: false,
  },
  {
    producer: "Arena",
    sourceKind: "arena",
    ownerModule: "source/src/lib/builders/arena.ts",
    stateFile: "arena/runs.jsonl + arena/work/<run-id>",
    processOwner: "runArena lane child processes",
    abortPath: "lane timeout/process close; no durable cross-restart abort registry",
    restartBehavior: "completed run history is durable; live lane ownership is process-local",
    hasBuilderSession: false,
    hasBuilderId: true,
    hasKanbanAttempt: false,
  },
  {
    producer: "Builder API direct route",
    sourceKind: "builder",
    ownerModule: "source/src/app/api/builders/[id]/chat/route.ts",
    stateFile: "none; response stream is request-scoped",
    processOwner: "Builder API route via runBuilderChat",
    abortPath: "request AbortSignal plus process-tree kill on timeout",
    restartBehavior: "no durable request replay; caller owns any returned session id",
    hasBuilderSession: true,
    hasBuilderId: true,
    hasKanbanAttempt: false,
  },
  {
    producer: "FirstMate sessions",
    sourceKind: "chat",
    ownerModule: "source/src/lib/sen-sessions.ts",
    stateFile: "agents/firstmate/sessions.json + agents/firstmate-<session-id>/chat.jsonl",
    processOwner: "session store; execution is owned by the FirstMate chat route",
    abortPath: "no process ownership; delegates cancellation to the active chat request",
    restartBehavior: "session metadata and Builder resume identity reload from disk",
    hasBuilderSession: true,
    hasBuilderId: true,
    hasKanbanAttempt: false,
  },
  {
    producer: "ACP pool",
    sourceKind: "chat",
    ownerModule: "source/src/lib/builders/acp.ts",
    stateFile: "none; pooled lane/session state is process-local",
    processOwner: "ACP/Claude duplex/Codex app-server pool",
    abortPath: "request AbortSignal; drainAcpPool closes all pooled lanes",
    restartBehavior: "pool is discarded on restart; callers may resume from a persisted vendor session id",
    hasBuilderSession: true,
    hasBuilderId: true,
    hasKanbanAttempt: false,
  },
  {
    producer: "Herdr pane registry",
    sourceKind: "delegation",
    ownerModule: "source/src/lib/agentRuntime/toolkits/herdrWorkers.ts",
    stateFile: "none; runId-to-pane registry is process-local",
    processOwner: "per-run Herdr worker registry",
    abortPath: "close_worker/closePane for panes owned by the run",
    restartBehavior: "registry is lost on restart; existing Herdr panes are not implicitly reclaimed",
    hasBuilderSession: false,
    hasBuilderId: true,
    hasKanbanAttempt: false,
  },
  {
    producer: "Kanban dispatch abort registry",
    sourceKind: "kanban",
    ownerModule: "source/src/app/api/agent-kanban/dispatch/route.ts",
    stateFile: "Agent Kanban attempt/events are durable; AbortController map is not",
    processOwner: "activeDispatches map keyed by Kanban attempt id",
    abortPath: "DELETE dispatch aborts the registered attempt controller",
    restartBehavior: "abort registry is lost; durable attempt state remains for reconciliation",
    hasBuilderSession: true,
    hasBuilderId: true,
    hasKanbanAttempt: true,
  },
  {
    producer: "Automation scheduler/in-flight map",
    sourceKind: "automation",
    ownerModule: "source/src/lib/automations.ts",
    stateFile: "automations.json + automations/runs/<run-id>.json; timer/in-flight map is process-local",
    processOwner: "60-second scheduler timer and global in-flight map",
    abortPath: "no durable scheduler-wide cancellation owner",
    restartBehavior: "ensureScheduler restarts lazily and catch-up-once uses durable run records",
    hasBuilderSession: false,
    hasBuilderId: false,
    hasKanbanAttempt: false,
  },
  {
    producer: "Approval resume entry point",
    sourceKind: "agent",
    ownerModule: "source/src/app/api/firstmate/agent/route.ts + source/src/lib/automations.ts",
    stateFile: "approvals.json + runtime/runs/<run-id>.json",
    processOwner: "FirstMate agent POST resume or automation decideAndExecute",
    abortPath: "resumed runner inherits the request/runtime AbortSignal",
    restartBehavior: "decision and blocked RunState are durable; resume is explicitly re-entered",
    hasBuilderSession: false,
    hasBuilderId: false,
    hasKanbanAttempt: false,
  },
];

export interface ProducerLifecycleEntry extends ProducerInventoryEntry {
  schedulerBootstrap: string;
  shutdownPath: string;
  durableOwner: string;
  consumers: string[];
}

const LIFECYCLE_DETAILS: Record<string, Pick<
  ProducerLifecycleEntry,
  "schedulerBootstrap" | "shutdownPath" | "durableOwner" | "consumers"
>> = {
  "FirstMate/Sen Agent runtime": {
    schedulerBootstrap: "request entry point; no background scheduler",
    shutdownPath: "request AbortSignal then runner/tool close hooks",
    durableOwner: "FileStateStore owns RunState; live process ownership is request-local",
    consumers: ["FirstMate Agent UI", "automation resume", "approval inbox", "thread/session readers"],
  },
  "Automation scheduler": {
    schedulerBootstrap: "ensureScheduler lazy bootstrap from automation API access",
    shutdownPath: "no complete drain hook in current implementation",
    durableOwner: "automation run files own history; timer and in-flight ownership are process-local",
    consumers: ["Automations UI", "approval inbox", "scheduler catch-up"],
  },
  "Sen chat": {
    schedulerBootstrap: "request entry point; ACP pool initializes on demand",
    shutdownPath: "request AbortSignal and drainAcpPool",
    durableOwner: "Sen session index and transcript files own completed conversation state",
    consumers: ["Sen Chat UI", "Agent Kanban bridge", "session history readers"],
  },
  "Agent Kanban": {
    schedulerBootstrap: "dispatch route explicitly starts an attempt",
    shutdownPath: "dispatch DELETE abort plus executor close",
    durableOwner: "Kanban event log is authority; cards snapshot is a projection",
    consumers: ["Kanban board UI", "dispatch API", "attempt detail/live stream", "governance metrics"],
  },
  Delegation: {
    schedulerBootstrap: "parent agent tool invocation",
    shutdownPath: "parent abort signal closes the child Builder process",
    durableOwner: "parent RunState owns completed delegate output",
    consumers: ["parent agent runtime", "delegation fallback policy"],
  },
  Arena: {
    schedulerBootstrap: "explicit runArena caller",
    shutdownPath: "lane timeout/abort closes child processes",
    durableOwner: "arena runs JSONL owns completed outcomes only",
    consumers: ["Arena UI", "Builder ranking/history"],
  },
  "Builder API direct route": {
    schedulerBootstrap: "request entry point",
    shutdownPath: "request AbortSignal and process-tree kill",
    durableOwner: "caller owns the response and optional Builder session identity",
    consumers: ["Builder chat API clients", "CLI Config smoke flows"],
  },
  "FirstMate sessions": {
    schedulerBootstrap: "none; passive session store",
    shutdownPath: "none; active chat route owns shutdown",
    durableOwner: "session index and transcript JSONL",
    consumers: ["Sen Chat UI", "session takeover/handoff", "Kanban link-session"],
  },
  "ACP pool": {
    schedulerBootstrap: "on-demand lane acquisition",
    shutdownPath: "drainAcpPool",
    durableOwner: "none for live lanes; vendor session id is projected into Sen sessions",
    consumers: ["Sen Chat route", "Builder session resume"],
  },
  "Herdr pane registry": {
    schedulerBootstrap: "parent Agent tool invocation",
    shutdownPath: "close_worker/closePane for every run-owned pane",
    durableOwner: "parent RunState owns recorded results; panes are external live state",
    consumers: ["Sen agent runtime", "Herdr worker tools"],
  },
  "Kanban dispatch abort registry": {
    schedulerBootstrap: "dispatch POST registration",
    shutdownPath: "abort every activeDispatches controller",
    durableOwner: "Kanban attempt/event log; AbortController registry is ephemeral",
    consumers: ["Kanban dispatch DELETE", "Kanban attempt UI"],
  },
  "Automation scheduler/in-flight map": {
    schedulerBootstrap: "ensureScheduler lazy 60-second timer",
    shutdownPath: "missing durable drain hook; Phase 3/7 must add one",
    durableOwner: "automation definitions and run files; live claims are ephemeral",
    consumers: ["automation scheduler", "Automations UI", "approval decision handler"],
  },
  "Approval resume entry point": {
    schedulerBootstrap: "explicit POST resume or automation decision handler",
    shutdownPath: "request/runtime AbortSignal",
    durableOwner: "approval record plus revisioned RunState",
    consumers: ["FirstMate Agent UI", "Automations inbox", "agent runtime resume"],
  },
};

export const PRODUCER_LIFECYCLE_MATRIX: ProducerLifecycleEntry[] = PRODUCER_INVENTORY.map((entry) => {
  const lifecycle = LIFECYCLE_DETAILS[entry.producer];
  if (!lifecycle) throw new Error(`Missing lifecycle inventory for ${entry.producer}`);
  return { ...entry, ...lifecycle };
});

export function envelopeFromRunState(state: RunState): RunEnvelope {
  const artifacts = Array.isArray(state.artifacts) ? state.artifacts : [];

  return {
    schemaVersion: RUN_ENVELOPE_SCHEMA_VERSION,
    runId: state.id,
    threadId: state.threadId,
    sourceRef: { kind: "agent", id: state.id },
    producerRef: { kind: "sen", id: state.agentName },
    status: mapRuntimeStatus(state.status),
    createdAt: state.createdAt,
    endedAt: isTerminalRuntimeStatus(state.status) ? state.updatedAt : undefined,
    artifacts: artifacts.map((artifact) => ({
      id: artifact.path,
      kind: artifact.kind,
      uri: artifact.path,
      createdAt: artifact.createdAt,
      redactionClass: "local-sensitive",
    })),
    error: state.status === "failed"
      ? { class: "process", message: lastError(state.steps) ?? "Agent run failed", retryable: false }
      : undefined,
    metadata: {
      revision: state.revision,
      pendingApproval: state.pendingApproval ? {
        toolCallId: state.pendingApproval.toolCallId,
        tool: state.pendingApproval.tool,
        args: REDACTED_LOCAL_VALUE,
        redactionClass: "local-sensitive",
      } : undefined,
      brain: state.brain,
    },
  };
}

export function envelopeFromAutomationRun(run: AutomationRun): RunEnvelope {
  const output = run.output && typeof run.output === "object" ? run.output : undefined;

  return {
    schemaVersion: RUN_ENVELOPE_SCHEMA_VERSION,
    runId: run.id,
    sourceRef: { kind: "automation", id: run.automationId },
    producerRef: { kind: "automation", id: run.automationId },
    status: mapRuntimeStatus(run.status),
    createdAt: run.startedAt,
    startedAt: run.startedAt,
    endedAt: isTerminalAutomationStatus(run.status) ? addDurationIso(run.startedAt, run.durationMs) : undefined,
    builderSessionId: undefined,
    error: output?.kind === "builder" && output.error
      ? { class: "process", message: output.error, retryable: false }
      : undefined,
    metadata: {
      trigger: run.trigger,
      outputKind: output?.kind,
      durationMs: run.durationMs,
    },
  };
}

export function envelopeFromChatResult(params: {
  runId: string;
  builderId: string;
  result: ChatResult;
  createdAt: string;
  threadId?: string;
}): RunEnvelope {
  return {
    schemaVersion: RUN_ENVELOPE_SCHEMA_VERSION,
    runId: params.runId,
    threadId: params.threadId,
    sourceRef: { kind: "chat", id: params.threadId ?? params.runId },
    producerRef: { kind: "builder-api", id: params.builderId },
    builderId: params.builderId,
    builderSessionId: params.result.sessionId ?? undefined,
    status: params.result.timedOut ? "failed" : params.result.exitCode === 0 ? "succeeded" : "failed",
    createdAt: params.createdAt,
    startedAt: params.createdAt,
    endedAt: addDurationIso(params.createdAt, params.result.durationMs),
    usage: usageOrUndefined(params.result.usage ?? undefined),
    error: params.result.error
      ? { class: params.result.timedOut ? "timeout" : "process", message: params.result.error, retryable: false }
      : undefined,
    metadata: {
      actualModel: params.result.actualModel ?? undefined,
      ttfbMs: params.result.ttfbMs ?? undefined,
      durationMs: params.result.durationMs,
      capability: params.result.capability,
    },
  };
}

export function envelopeFromKanbanWorkItem(item: WorkItem, attempt?: KanbanAttempt): RunEnvelope {
  return {
    schemaVersion: RUN_ENVELOPE_SCHEMA_VERSION,
    runId: attempt ? `${item.id}:${attempt.id}` : item.id,
    sourceRef: { kind: "kanban", id: item.id },
    producerRef: { kind: "kanban", id: "agent-kanban-executor" },
    kanbanAttemptId: attempt?.id,
    builderId: attempt?.builderId,
    builderSessionId: attempt?.sessionId,
    status: attempt ? mapAttemptStatus(attempt.status) : mapKanbanRuntimeState(item.runtimeState),
    createdAt: item.createdAt,
    startedAt: attempt?.startedAt,
    endedAt: attempt?.endedAt ?? item.doneAt,
    usage: usageOrUndefined(attempt?.usage),
    error: attempt?.error ? { class: "process", message: attempt.error, retryable: false } : undefined,
    metadata: {
      workflowStage: item.workflowStage,
      runtimeState: item.runtimeState,
      activeAttemptId: item.activeAttemptId,
      attemptRole: attempt?.role,
      source: item.source,
      links: item.links,
      originProducerRef: item.source.kind === "firstmate" && item.source.sessionId
        ? { kind: "firstmate", id: item.source.sessionId }
        : undefined,
    },
  };
}

function mapRuntimeStatus(status: string): RunStatus {
  switch (status) {
    case "running": return "running";
    case "blocked": return "blocked";
    case "done": return "succeeded";
    case "max-turns": return "failed";
    case "failed": return "failed";
    case "cancelled": return "cancelled";
    case "stopped": return "cancelled";
    default: return "orphaned";
  }
}

function mapAttemptStatus(status: KanbanAttempt["status"]): RunStatus {
  switch (status) {
    case "created": return "queued";
    case "queued": return "queued";
    case "running": return "running";
    case "needs_input": return "blocked";
    case "succeeded": return "succeeded";
    case "failed": return "failed";
    case "stopped": return "cancelled";
  }
}

function mapKanbanRuntimeState(status: WorkItem["runtimeState"]): RunStatus {
  switch (status) {
    case "idle": return "queued";
    case "queued": return "queued";
    case "running": return "running";
    case "needs_input": return "blocked";
    case "blocked": return "blocked";
    case "quota_wait": return "blocked";
    case "failed": return "failed";
    case "stopped": return "cancelled";
  }
}

function isTerminalRuntimeStatus(status: string): boolean {
  return status === "done" || status === "failed" || status === "max-turns";
}

function isTerminalAutomationStatus(status: string): boolean {
  return isTerminalRuntimeStatus(status) || status === "cancelled" || status === "stopped";
}

function lastError(steps: RunState["steps"]): string | undefined {
  return [...steps].reverse().find((step) => typeof step.error === "string")?.error;
}

function usageOrUndefined(usage?: UsageTotals | null): UsageTotals | undefined {
  if (!usage) return undefined;
  const clean: UsageTotals = {};
  if (typeof usage.input === "number") clean.input = usage.input;
  if (typeof usage.output === "number") clean.output = usage.output;
  if (typeof usage.thinking === "number") clean.thinking = usage.thinking;
  return Object.keys(clean).length ? clean : undefined;
}

function addDurationIso(startedAt: string, durationMs: number): string | undefined {
  const startMs = Date.parse(startedAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(durationMs)) return undefined;
  return new Date(startMs + durationMs).toISOString();
}
