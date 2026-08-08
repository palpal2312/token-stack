import assert from "node:assert/strict";
import test from "node:test";

import {
  importMapping,
  legacyMappingKey,
  mapAttemptStatus,
  mapCodexGoal,
  mapKanbanAttempt,
  mapKanbanWorkItem,
  mapRuntimeState,
  mapSenTask,
  mapVaultGoal,
  mapWorkflowStage,
} from "./canonical-adapters";
import type { WorkItem } from "../agent-kanban/types";
import type { CodexGoal } from "../codexGoals";

test("legacyMappingKey is deterministic and not a Go canonical ID", () => {
  assert.equal(
    legacyMappingKey("task", "agent-kanban", "Card 123"),
    "news:task:agent-kanban:card-123",
  );
  assert.equal(
    legacyMappingKey("goal", "vault-goals", "abc", "acme"),
    "acme:goal:vault-goals:abc",
  );
});

test("state mapping keeps workflow and runtime layers separate", () => {
  assert.equal(mapWorkflowStage("reviewed"), "ready2review");
  assert.equal(mapWorkflowStage("archived"), "archived");
  assert.equal(mapRuntimeState("blocked"), "needs_input");
  assert.equal(mapRuntimeState("quota_wait"), "quota_wait");
  assert.equal(mapAttemptStatus("queued"), "created");
  assert.equal(mapAttemptStatus("stopped"), "cancelled");
});

test("mapKanbanWorkItem imports a Task, never a Goal", () => {
  const card: WorkItem = {
    id: "card_1",
    title: "Implement API",
    brief: "Projection-first API",
    workflowStage: "doing",
    runtimeState: "running",
    source: { kind: "manual" },
    attempts: [{ id: "attempt_1", builderId: "builder_1", role: "builder", status: "running" }],
    activeAttemptId: "attempt_1",
    links: { branch: "feature/api" },
    createdAt: "2026-08-04T00:00:00.000Z",
    updatedAt: "2026-08-04T00:01:00.000Z",
    stageChangedAt: "2026-08-04T00:01:00.000Z",
  };
  const mapped = mapKanbanWorkItem(card);
  assert.equal(mapped.ref.kind, "task");
  assert.equal(mapped.ref.legacyKey, "news:task:agent-kanban:card_1");
  assert.equal(mapped.ref.canonicalID, undefined);
  assert.equal(mapped.workflowState, "doing");
  assert.equal(mapped.runtimeState, "running");
  assert.equal(mapped.primaryBuilderID, "builder_1");
  assert.equal(mapped.activeAttemptRef?.legacyKey, "news:attempt:agent-kanban:attempt_1");
  assert.equal(mapped.warnings[0].code, "manual-source");
  const mapping = importMapping(mapped.ref, mapped.warnings);
  assert.equal(mapping.legacyKey, mapped.ref.legacyKey);
  assert.equal(mapping.importStatus, "candidate");
  assert.equal(mapping.canonicalID, undefined);
});

test("mapKanbanWorkItem warns on missing active attempt", () => {
  const card: WorkItem = {
    id: "card_2",
    title: "Broken card",
    brief: "",
    workflowStage: "todo",
    runtimeState: "idle",
    source: { kind: "import" },
    attempts: [],
    activeAttemptId: "missing",
    links: {},
    createdAt: "2026-08-04T00:00:00.000Z",
    updatedAt: "2026-08-04T00:01:00.000Z",
    stageChangedAt: "2026-08-04T00:01:00.000Z",
  };
  const mapped = mapKanbanWorkItem(card);
  assert.equal(mapped.activeAttemptRef, undefined);
  assert.equal(mapped.warnings[0].code, "missing-active-attempt");
});

test("mapKanbanAttempt preserves task linkage, attempt status, and provenance", () => {
  const task = mapKanbanWorkItem({
    id: "card_1",
    title: "Implement API",
    brief: "Projection-first API",
    workflowStage: "doing",
    runtimeState: "running",
    source: { kind: "planner" },
    attempts: [],
    links: {},
    createdAt: "2026-08-04T00:00:00.000Z",
    updatedAt: "2026-08-04T00:01:00.000Z",
    stageChangedAt: "2026-08-04T00:01:00.000Z",
  });
  const mapped = mapKanbanAttempt(task.ref, {
    id: "attempt_1",
    builderId: "builder_1",
    role: "builder",
    status: "needs_input",
    sessionId: "pane_1",
    actualModel: "kimi-k2",
    effort: "high",
    error: "waiting",
    note: "needs user input",
  });
  assert.equal(mapped.ref.kind, "attempt");
  assert.equal(mapped.taskRef.legacyKey, task.ref.legacyKey);
  assert.equal(mapped.status, "running");
  assert.deepEqual(mapped.provenance.actualModel, "kimi-k2");
  assert.equal(mapped.warnings[0].code, "attempt-needs-input");
});

test("legacy goal stores import with warnings instead of canonical write authority", () => {
  const vault = mapVaultGoal({ id: "goal1", text: "Ship SEN", done: false, category: "release", createdAt: "2026-08-04T00:00:00.000Z" });
  assert.equal(vault.ref.kind, "goal");
  assert.equal(vault.ref.canonicalID, undefined);
  assert.equal(vault.title, "Ship SEN");
  assert.equal(vault.warnings[0].code, "legacy-goal-source");

  const codexGoal: CodexGoal = {
    id: "codex1",
    title: "Build domain",
    prompt: "Implement canonical domain",
    status: "completed",
    createdAt: Date.now(),
    cwd: "C:/tmp/codex1",
    logFile: "C:/tmp/codex1.log",
  };
  const codex = mapCodexGoal(codexGoal);
  assert.equal(codex.ref.kind, "task");
  assert.equal(codex.workflowState, "ready2review");
  assert.equal(codex.runtimeState, "idle");
  assert.equal(codex.warnings[0].code, "legacy-task-source");
  assert.equal(codex.warnings[1].code, "process-completed-not-done");
});

test("SEN home tasks import as shadow-read provenance only", () => {
  const mapped = mapSenTask({ id: "t1", fields: { title: "Scout", backend: "kimi" }, mtime: 42 });
  assert.equal(mapped.ref.kind, "task");
  assert.equal(mapped.title, "Scout");
  assert.equal(mapped.primaryBuilderID, "kimi");
  assert.equal(mapped.warnings[0].code, "sen-home-shadow-read");
});
