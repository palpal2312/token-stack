import type { KanbanActor, WorkflowStage } from "./types";

const EDGES: Record<WorkflowStage, readonly WorkflowStage[]> = {
  backlog: ["todo"],
  todo: ["doing"],
  doing: ["ready2review", "todo"],
  ready2review: ["reviewed", "doing"],
  reviewed: ["committed"],
  committed: ["merging"],
  merging: ["archived"],
  archived: ["backlog"],
};

function actorAllows(actor: KanbanActor, from: WorkflowStage, to: WorkflowStage): boolean {
  if (actor === "user") return true;
  if (actor === "firstmate") {
    return (from === "backlog" && to === "todo")
      || (from === "todo" && to === "doing")
      || (from === "reviewed" && to === "committed");
  }
  if (actor === "owner") {
    return from === "doing" && (to === "ready2review" || to === "todo");
  }
  if (actor === "reviewer") {
    return from === "ready2review" && (to === "reviewed" || to === "doing");
  }
  return actor === "system"
    && ((from === "committed" && to === "merging")
      || (from === "merging" && to === "archived"));
}

export function validateTransition(
  from: WorkflowStage,
  to: WorkflowStage,
  actor: KanbanActor,
): string | null {
  if (from === to) return "Card is already in that workflow stage.";
  if (!EDGES[from].includes(to)) return `Invalid workflow transition: ${from} → ${to}.`;
  if (!actorAllows(actor, from, to)) return `Actor "${actor}" cannot move ${from} → ${to}.`;
  return null;
}

export function allowedTransitions(from: WorkflowStage, actor: KanbanActor): WorkflowStage[] {
  return EDGES[from].filter((to) => actorAllows(actor, from, to));
}

