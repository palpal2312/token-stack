// Compatibility mapping helpers for Phase 03 canonical domain adoption.
//
// These functions are intentionally pure: they do not write canonical state and do
// not dual-write legacy stores. They produce deterministic import/shadow-read
// records and mapping keys so `sen.ts`, `vaultWriter.ts`, `codexGoals.ts`, and
// `agent-kanban/*` can be migrated behind Go/PostgreSQL without treating local
// files as authority.

import type { WorkItem, KanbanAttempt, WorkflowStage, RuntimeState, AttemptStatus } from "../agent-kanban/types";
import type { Goal as VaultGoal } from "../vaultWriter";
import type { CodexGoal } from "../codexGoals";
import type { SenTask } from "../sen";

export type CanonicalIDKind = "ug" | "goal" | "task" | "attempt" | "cmd";
export type LegacySource = "sen-home" | "vault-goals" | "codex-goals" | "agent-kanban";

export interface CanonicalRef {
  /**
   * Deterministic compatibility key for import/reconciliation. This is NOT a Go
   * canonical ID; canonical IDs still come from the Go/PostgreSQL command path.
   */
  legacyKey: string;
  /** Canonical ID after import/promotion, absent during shadow-read mapping. */
  canonicalID?: string;
  kind: CanonicalIDKind;
  legacySource: LegacySource;
  legacyID: string;
}

export type CanonicalTaskWorkflowState = "backlog" | "todo" | "doing" | "ready2review" | "done" | "archived";
export type CanonicalTaskRuntimeState = "idle" | "queued" | "leased" | "running" | "needs_input" | "quota_wait" | "failed" | "stopped";
export type CanonicalAttemptStatus = "created" | "leased" | "running" | "succeeded" | "failed" | "cancelled" | "timed_out" | "orphaned";
export type CanonicalExecutionStrategy = "direct" | "loop" | "workflow" | "graph";
export type CanonicalIsolationRequirement = "host_allowed" | "sandbox_required";

export interface CanonicalImportWarning {
  code: string;
  message: string;
  legacySource: LegacySource;
  legacyID: string;
}

export interface CanonicalImportMapping {
  legacyKey: string;
  legacySource: LegacySource;
  legacyID: string;
  canonicalKind: CanonicalIDKind;
  canonicalID?: string;
  importStatus: "candidate" | "promoted" | "quarantined" | "waived";
  warnings: CanonicalImportWarning[];
}

export interface CanonicalTaskImport {
  ref: CanonicalRef;
  title: string;
  brief: string;
  workflowState: CanonicalTaskWorkflowState;
  runtimeState: CanonicalTaskRuntimeState;
  executionStrategy: CanonicalExecutionStrategy;
  isolationRequirement: CanonicalIsolationRequirement;
  primaryBuilderID: string;
  activeAttemptRef?: CanonicalRef;
  provenance: Record<string, unknown>;
  warnings: CanonicalImportWarning[];
}

export interface CanonicalGoalImport {
  ref: CanonicalRef;
  title: string;
  desiredOutcome: string;
  done: boolean;
  provenance: Record<string, unknown>;
  warnings: CanonicalImportWarning[];
}

export interface CanonicalAttemptImport {
  ref: CanonicalRef;
  taskRef: CanonicalRef;
  builderID: string;
  status: CanonicalAttemptStatus;
  provenance: Record<string, unknown>;
  warnings: CanonicalImportWarning[];
}

const KEY_SAFE = /[^a-zA-Z0-9_-]+/g;

export function legacyMappingKey(kind: CanonicalIDKind, source: LegacySource, legacyID: string, prefix = "news"): string {
  const safeSource = source.replace(KEY_SAFE, "-").toLowerCase();
  const safeLegacy = String(legacyID || "missing").replace(KEY_SAFE, "-").toLowerCase().slice(0, 80);
  return `${prefix}:${kind}:${safeSource}:${safeLegacy}`;
}

export function legacyRef(kind: CanonicalIDKind, source: LegacySource, legacyID: string, prefix = "news"): CanonicalRef {
  return {
    legacyKey: legacyMappingKey(kind, source, legacyID, prefix),
    kind,
    legacySource: source,
    legacyID,
  };
}

export function importMapping(ref: CanonicalRef, warnings: CanonicalImportWarning[] = []): CanonicalImportMapping {
  return {
    legacyKey: ref.legacyKey,
    legacySource: ref.legacySource,
    legacyID: ref.legacyID,
    canonicalKind: ref.kind,
    canonicalID: ref.canonicalID,
    importStatus: ref.canonicalID ? "promoted" : "candidate",
    warnings,
  };
}

export function mapWorkflowStage(stage: WorkflowStage): CanonicalTaskWorkflowState {
  switch (stage) {
    case "backlog": return "backlog";
    case "todo": return "todo";
    case "doing": return "doing";
    case "ready2review":
    case "reviewed":
    case "committed":
    case "merging":
      return "ready2review";
    case "archived": return "archived";
  }
}

export function mapRuntimeState(state: RuntimeState): CanonicalTaskRuntimeState {
  switch (state) {
    case "idle": return "idle";
    case "queued": return "queued";
    case "running": return "running";
    case "needs_input":
    case "blocked":
      return "needs_input";
    case "quota_wait": return "quota_wait";
    case "failed": return "failed";
    case "stopped": return "stopped";
  }
}

export function mapAttemptStatus(status: AttemptStatus): CanonicalAttemptStatus {
  switch (status) {
    case "created":
    case "queued":
      return "created";
    case "running":
    case "needs_input":
      return "running";
    case "succeeded": return "succeeded";
    case "failed": return "failed";
    case "stopped": return "cancelled";
  }
}

export function mapKanbanWorkItem(card: WorkItem, prefix = "news"): CanonicalTaskImport {
  const warnings: CanonicalImportWarning[] = [];
  if (card.source.kind === "manual") {
    warnings.push(warning("manual-source", "Manual Kanban card requires import review before canonical promotion.", "agent-kanban", card.id));
  }
  const activeAttempt = card.activeAttemptId
    ? card.attempts.find((entry) => entry.id === card.activeAttemptId)
    : undefined;
  if (card.activeAttemptId && !activeAttempt) {
    warnings.push(warning("missing-active-attempt", "Legacy card references an active attempt that is absent from attempts[].", "agent-kanban", card.id));
  }
  return {
    ref: legacyRef("task", "agent-kanban", card.id, prefix),
    title: card.title,
    brief: card.brief,
    workflowState: mapWorkflowStage(card.workflowStage),
    runtimeState: mapRuntimeState(card.runtimeState),
    executionStrategy: "direct",
    isolationRequirement: "host_allowed",
    primaryBuilderID: activeBuilder(card.attempts, card.activeAttemptId),
    activeAttemptRef: activeAttempt ? legacyRef("attempt", "agent-kanban", activeAttempt.id, prefix) : undefined,
    provenance: { source: card.source, links: card.links, createdAt: card.createdAt, updatedAt: card.updatedAt },
    warnings,
  };
}

export function mapKanbanAttempt(taskRef: CanonicalRef, attempt: KanbanAttempt, prefix = "news"): CanonicalAttemptImport {
  return {
    ref: legacyRef("attempt", "agent-kanban", attempt.id, prefix),
    taskRef,
    builderID: attempt.builderId,
    status: mapAttemptStatus(attempt.status),
    provenance: {
      role: attempt.role,
      sessionId: attempt.sessionId,
      startedAt: attempt.startedAt,
      endedAt: attempt.endedAt,
      actualModel: attempt.actualModel,
      effort: attempt.effort,
      usage: attempt.usage,
      error: attempt.error,
      note: attempt.note,
    },
    warnings: attempt.status === "needs_input"
      ? [warning("attempt-needs-input", "Canonical attempt imports needs_input as running plus provenance until runtime state owns blocking detail.", "agent-kanban", attempt.id)]
      : [],
  };
}

export function mapVaultGoal(goal: VaultGoal, prefix = "news"): CanonicalGoalImport {
  return {
    ref: legacyRef("goal", "vault-goals", goal.id, prefix),
    title: goal.text.slice(0, 160),
    desiredOutcome: goal.text,
    done: goal.done,
    provenance: { category: goal.category, createdAt: goal.createdAt },
    warnings: [warning("legacy-goal-source", "Vault goals import as compatibility records; they are not canonical writers and require an UltimateGoal parent before promotion.", "vault-goals", goal.id)],
  };
}

export function mapCodexGoal(goal: CodexGoal, prefix = "news"): CanonicalTaskImport {
  const runtimeState: CanonicalTaskRuntimeState = goal.status === "running"
    ? "running"
    : goal.status === "queued"
      ? "queued"
      : goal.status === "completed"
        ? "idle"
        : goal.status === "failed"
          ? "failed"
          : "stopped";
  const warnings = [warning("legacy-task-source", "Codex goals import as Task candidates; mutations must move through canonical command_id receipts.", "codex-goals", goal.id)];
  if (goal.status === "completed") {
    warnings.push(warning("process-completed-not-done", "Codex process completion is runtime evidence only; canonical Task done still requires acceptance criteria and Definition of Done review.", "codex-goals", goal.id));
  }
  return {
    ref: legacyRef("task", "codex-goals", goal.id, prefix),
    title: goal.title,
    brief: goal.prompt,
    workflowState: goal.status === "completed" ? "ready2review" : "todo",
    runtimeState,
    executionStrategy: "direct",
    isolationRequirement: "host_allowed",
    primaryBuilderID: "codex",
    provenance: { cwd: goal.cwd, logFile: goal.logFile, createdAt: goal.createdAt, startedAt: goal.startedAt, finishedAt: goal.finishedAt, exitCode: goal.exitCode },
    warnings,
  };
}

export function mapSenTask(task: SenTask, prefix = "news"): CanonicalTaskImport {
  return {
    ref: legacyRef("task", "sen-home", task.id, prefix),
    title: task.fields.title || task.fields.name || task.id,
    brief: task.fields.brief || task.fields.prompt || "",
    workflowState: "todo",
    runtimeState: "idle",
    executionStrategy: "direct",
    isolationRequirement: "host_allowed",
    primaryBuilderID: task.fields.builder || task.fields.backend || "",
    provenance: { fields: task.fields, mtime: task.mtime },
    warnings: [warning("sen-home-shadow-read", "SEN home state is shadow-read/import provenance only, not canonical authority.", "sen-home", task.id)],
  };
}

function activeBuilder(attempts: KanbanAttempt[], activeAttemptId?: string): string {
  const attempt = attempts.find((entry) => entry.id === activeAttemptId) ?? attempts[attempts.length - 1];
  return attempt?.builderId ?? "";
}

function warning(code: string, message: string, legacySource: LegacySource, legacyID: string): CanonicalImportWarning {
  return { code, message, legacySource, legacyID };
}
