export const WORKFLOW_STAGES = [
  "backlog",
  "todo",
  "doing",
  "ready2review",
  "reviewed",
  "committed",
  "merging",
  "archived",
] as const;

export type WorkflowStage = (typeof WORKFLOW_STAGES)[number];

export const RUNTIME_STATES = [
  "idle",
  "queued",
  "running",
  "needs_input",
  "blocked",
  "quota_wait",
  "failed",
  "stopped",
] as const;

export type RuntimeState = (typeof RUNTIME_STATES)[number];

export const ATTEMPT_STATUSES = [
  "created",
  "queued",
  "running",
  "needs_input",
  "succeeded",
  "failed",
  "stopped",
] as const;

export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];
export type KanbanRole = "planner" | "builder" | "reviewer";
export type KanbanActor = "user" | "firstmate" | "owner" | "reviewer" | "system";

export interface KanbanAttempt {
  id: string;
  builderId: string;
  role: KanbanRole;
  sessionId?: string;
  status: AttemptStatus;
  startedAt?: string;
  endedAt?: string;
  actualModel?: string;
  effort?: string;
  usage?: { input?: number; output?: number; thinking?: number };
  error?: string;
  note?: string;
}

export interface KanbanLinks {
  projectPath?: string;
  worktreePath?: string;
  branch?: string;
  prUrl?: string;
  artifactId?: string;
}

export interface KanbanSource {
  kind: "manual" | "firstmate" | "planner" | "import";
  sessionId?: string;
}

export interface WorkItem {
  id: string;
  title: string;
  brief: string;
  workflowStage: WorkflowStage;
  runtimeState: RuntimeState;
  source: KanbanSource;
  attempts: KanbanAttempt[];
  activeAttemptId?: string;
  links: KanbanLinks;
  createdAt: string;
  updatedAt: string;
  stageChangedAt: string;
  doneAt?: string;
  note?: string;
}

export interface KanbanEvent {
  seq: number;
  id: string;
  at: string;
  type:
    | "card_created"
    | "card_updated"
    | "card_deleted"
    | "workflow_transition"
    | "runtime_changed"
    | "attempt_created"
    | "attempt_updated"
    | "migration_applied";
  actor: KanbanActor;
  cardId?: string;
  attemptId?: string;
  payload: Record<string, unknown>;
}

export interface KanbanSnapshot {
  version: 1;
  lastAppliedSeq: number;
  cards: WorkItem[];
  migrations: string[];
  processedCommands: string[];
}

export interface TransitionRequest {
  cardId: string;
  to: WorkflowStage;
  actor: KanbanActor;
  note?: string;
  commandId?: string;
  attemptId?: string;
}

export interface CreateCardInput {
  title: string;
  brief?: string;
  source?: KanbanSource;
  workflowStage?: WorkflowStage;
  runtimeState?: RuntimeState;
  links?: KanbanLinks;
  note?: string;
}

export interface KanbanRoleChoice {
  engine: "builder" | "ollama" | "hermes";
  builderId?: string;
}

export interface KanbanRoleConfig {
  planner: KanbanRoleChoice;
  builder: KanbanRoleChoice;
  reviewer: KanbanRoleChoice;
}

export const DEFAULT_ROLE_CONFIG: KanbanRoleConfig = {
  planner: { engine: "ollama" },
  builder: { engine: "ollama" },
  reviewer: { engine: "ollama" },
};

export function isWorkflowStage(value: unknown): value is WorkflowStage {
  return typeof value === "string" && (WORKFLOW_STAGES as readonly string[]).includes(value);
}

export function isRuntimeState(value: unknown): value is RuntimeState {
  return typeof value === "string" && (RUNTIME_STATES as readonly string[]).includes(value);
}

export function isKanbanActor(value: unknown): value is KanbanActor {
  return value === "user" || value === "firstmate" || value === "owner"
    || value === "reviewer" || value === "system";
}

