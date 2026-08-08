/**
 * @deprecated Phase 09 & Phase 19 single-write cutover: Node-side JSONL store is legacy / fallback only.
 * Authority has migrated to the Go daemon / PostgreSQL event spine when SEN_GO_BUILDER_EXEC_AUTHORITY=1.
 */
import { appendFile, mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";
import { withFileLock } from "../fileLock";
import { writeTextAtomic } from "../llmops/storage";
import {
  ATTEMPT_STATUSES,
  isRuntimeState,
  isWorkflowStage,
  type AttemptStatus,
  type CreateCardInput,
  type KanbanActor,
  type KanbanAttempt,
  type KanbanEvent,
  type KanbanSnapshot,
  type RuntimeState,
  type TransitionRequest,
  type WorkItem,
  type WorkflowStage,
} from "./types";
import { validateTransition } from "./transitions";
import { publishKanbanEvent } from "./event-bus";
import { AGENTIC_HOME } from "@/lib/builders/registry";

export function kanbanRoot(): string {
  return path.join(process.env.AGENTIC_OS_HOME ?? AGENTIC_HOME, "agent-kanban");
}
function snapshotFile(): string { return path.join(kanbanRoot(), "cards.json"); }
function eventsFile(): string { return path.join(kanbanRoot(), "events.jsonl"); }

const EMPTY: KanbanSnapshot = {
  version: 1,
  lastAppliedSeq: 0,
  cards: [],
  migrations: [],
  processedCommands: [],
};

const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
let cached: KanbanSnapshot | null = null;
let writeChain: Promise<unknown> = Promise.resolve();

export class KanbanStoreError extends Error {
  constructor(message: string, public readonly status: 400 | 404 | 409 | 500 = 400) {
    super(message);
  }
}

function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeChain.then(fn, fn);
  writeChain = next.catch(() => undefined);
  return next;
}

function cloneSnapshot(snapshot: KanbanSnapshot): KanbanSnapshot {
  return structuredClone(snapshot);
}

function now(): string { return new Date().toISOString(); }
function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeCard(raw: Partial<WorkItem>): WorkItem | null {
  if (!raw || typeof raw.id !== "string" || !ID_RE.test(raw.id)) return null;
  const createdAt = typeof raw.createdAt === "string" ? raw.createdAt : now();
  const stage = isWorkflowStage(raw.workflowStage) ? raw.workflowStage : "backlog";
  return {
    id: raw.id,
    title: String(raw.title ?? "Untitled").slice(0, 160),
    brief: String(raw.brief ?? "").slice(0, 12_000),
    workflowStage: stage,
    runtimeState: isRuntimeState(raw.runtimeState) ? raw.runtimeState : "idle",
    source: raw.source && typeof raw.source === "object"
      ? {
        kind: raw.source.kind === "firstmate" || raw.source.kind === "planner"
          || raw.source.kind === "import" ? raw.source.kind : "manual",
        ...(typeof raw.source.sessionId === "string" ? { sessionId: raw.source.sessionId } : {}),
      }
      : { kind: "manual" },
    attempts: Array.isArray(raw.attempts)
      ? raw.attempts.filter((a): a is KanbanAttempt => Boolean(
        a && typeof a.id === "string" && ID_RE.test(a.id)
        && typeof a.builderId === "string" && ID_RE.test(a.builderId)
        && (a.role === "planner" || a.role === "builder" || a.role === "reviewer")
        && (ATTEMPT_STATUSES as readonly string[]).includes(a.status),
      ))
      : [],
    ...(typeof raw.activeAttemptId === "string" ? { activeAttemptId: raw.activeAttemptId } : {}),
    links: raw.links && typeof raw.links === "object" ? { ...raw.links } : {},
    createdAt,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : createdAt,
    stageChangedAt: typeof raw.stageChangedAt === "string" ? raw.stageChangedAt : createdAt,
    ...(typeof raw.doneAt === "string" ? { doneAt: raw.doneAt } : {}),
    ...(typeof raw.note === "string" ? { note: raw.note.slice(0, 2_000) } : {}),
  };
}

function applyEvent(snapshot: KanbanSnapshot, event: KanbanEvent): void {
  switch (event.type) {
    case "card_created": {
      const card = normalizeCard(event.payload.card as WorkItem);
      if (card && !snapshot.cards.some((c) => c.id === card.id)) snapshot.cards.push(card);
      break;
    }
    case "card_updated": {
      const card = normalizeCard(event.payload.card as WorkItem);
      if (!card) break;
      const i = snapshot.cards.findIndex((c) => c.id === card.id);
      if (i >= 0) snapshot.cards[i] = card;
      break;
    }
    case "card_deleted":
      snapshot.cards = snapshot.cards.filter((c) => c.id !== event.cardId);
      break;
    case "workflow_transition": {
      const card = snapshot.cards.find((c) => c.id === event.cardId);
      const to = event.payload.to;
      if (!card || !isWorkflowStage(to)) break;
      card.workflowStage = to;
      card.stageChangedAt = event.at;
      card.updatedAt = event.at;
      card.note = typeof event.payload.note === "string" ? event.payload.note : card.note;
      if (to === "archived") card.doneAt = event.at;
      else if (card.doneAt) delete card.doneAt;
      break;
    }
    case "runtime_changed": {
      const card = snapshot.cards.find((c) => c.id === event.cardId);
      if (!card || !isRuntimeState(event.payload.runtimeState)) break;
      card.runtimeState = event.payload.runtimeState;
      card.updatedAt = event.at;
      if (typeof event.payload.note === "string") card.note = event.payload.note;
      break;
    }
    case "attempt_created": {
      const card = snapshot.cards.find((c) => c.id === event.cardId);
      const attempt = event.payload.attempt as KanbanAttempt;
      if (!card || !attempt || card.attempts.some((a) => a.id === attempt.id)) break;
      card.attempts.push(attempt);
      card.activeAttemptId = attempt.id;
      card.runtimeState = attempt.status === "running" ? "running" : "queued";
      card.updatedAt = event.at;
      break;
    }
    case "attempt_updated": {
      const card = snapshot.cards.find((c) => c.id === event.cardId);
      if (!card) break;
      const i = card.attempts.findIndex((a) => a.id === event.attemptId);
      if (i < 0) break;
      card.attempts[i] = { ...card.attempts[i], ...(event.payload.patch as Partial<KanbanAttempt>) };
      card.updatedAt = event.at;
      break;
    }
    case "migration_applied": {
      const migrationId = String(event.payload.migrationId ?? "");
      const cards = Array.isArray(event.payload.cards) ? event.payload.cards : [];
      for (const raw of cards) {
        const card = normalizeCard(raw as WorkItem);
        if (card && !snapshot.cards.some((existing) => existing.id === card.id)) snapshot.cards.push(card);
      }
      if (migrationId && !snapshot.migrations.includes(migrationId)) snapshot.migrations.push(migrationId);
      break;
    }
  }
  if (typeof event.payload.commandId === "string"
    && !snapshot.processedCommands.includes(event.payload.commandId)) {
    snapshot.processedCommands = [...snapshot.processedCommands, event.payload.commandId].slice(-2_000);
  }
  snapshot.lastAppliedSeq = Math.max(snapshot.lastAppliedSeq, event.seq);
}

async function readEventsAfter(seq: number, limit = Number.POSITIVE_INFINITY): Promise<KanbanEvent[]> {
  let text = "";
  try { text = await readFile(eventsFile(), "utf8"); } catch { return []; }
  const events: KanbanEvent[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as KanbanEvent;
      if (Number.isSafeInteger(event.seq) && event.seq > seq) events.push(event);
    } catch { /* preserve the file; ignore an incomplete final line */ }
  }
  return events.sort((a, b) => a.seq - b.seq).slice(0, limit);
}

async function loadSnapshot(): Promise<KanbanSnapshot> {
  let snapshot = cloneSnapshot(EMPTY);
  try {
    const parsed = JSON.parse(await readFile(snapshotFile(), "utf8")) as Partial<KanbanSnapshot>;
    if (parsed.version !== 1 || !Array.isArray(parsed.cards)) {
      throw new KanbanStoreError(
        `Kanban snapshot is corrupt or unsupported: ${snapshotFile()}. The file was preserved.`,
        409,
      );
    }
    snapshot = {
      version: 1,
      lastAppliedSeq: Number.isSafeInteger(parsed.lastAppliedSeq) ? Number(parsed.lastAppliedSeq) : 0,
      cards: parsed.cards.map(normalizeCard).filter((x): x is WorkItem => Boolean(x)),
      migrations: Array.isArray(parsed.migrations) ? parsed.migrations.map(String).slice(-100) : [],
      processedCommands: Array.isArray(parsed.processedCommands)
        ? parsed.processedCommands.map(String).slice(-2_000) : [],
    };
  } catch (error) {
    if (error instanceof KanbanStoreError) throw error;
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      throw new KanbanStoreError(
        `Kanban snapshot cannot be read: ${String((error as Error)?.message ?? error)}. The file was preserved.`,
        409,
      );
    }
  }
  const replay = await readEventsAfter(snapshot.lastAppliedSeq);
  for (const event of replay) applyEvent(snapshot, event);
  // Reads replay an event-first tail in memory but never write it back. A GET
  // may overlap the writer between appendEvent() and writeSnapshot(); allowing
  // that reader to persist would create a second snapshot writer. The next
  // serialized mutation checkpoints the recovered state atomically.
  cached = snapshot;
  return snapshot;
}

async function writeSnapshot(snapshot: KanbanSnapshot): Promise<void> {
  // writeTextAtomic uses a unique pid+random tmp name (never a shared
  // cards.json.tmp) plus fsync before rename, so two processes cannot tear
  // the snapshot even if both slipped past the lock.
  await writeTextAtomic(snapshotFile(), `${JSON.stringify(snapshot, null, 2)}\n`);
}

async function appendEvent(event: KanbanEvent): Promise<void> {
  await mkdir(kanbanRoot(), { recursive: true });
  const handle = await open(eventsFile(), "a");
  try {
    await handle.write(`${JSON.stringify(event)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function commit(
  actor: KanbanActor,
  type: KanbanEvent["type"],
  opts: {
    cardId?: string;
    attemptId?: string;
    payload?: Record<string, unknown> | ((snapshot: KanbanSnapshot, at: string) => Record<string, unknown>);
    commandId?: string;
    validate?: (snapshot: KanbanSnapshot) => void;
  } = {},
): Promise<{ snapshot: KanbanSnapshot; event: KanbanEvent; duplicate: boolean }> {
  // The in-process chain serializes writers inside this process; the file
  // lock is the cross-process barrier against a second server pointed at the
  // same AGENTIC_OS_HOME. The lock sits INSIDE the chain — never the reverse —
  // so a process can never deadlock against itself.
  return serialized(() => withFileLock(kanbanRoot(), "cards", async () => {
    const snapshot = await loadSnapshot();
    if (opts.commandId && snapshot.processedCommands.includes(opts.commandId)) {
      return {
        snapshot: cloneSnapshot(snapshot),
        event: {
          seq: snapshot.lastAppliedSeq, id: opts.commandId, at: now(), type, actor,
          ...(opts.cardId ? { cardId: opts.cardId } : {}),
          ...(opts.attemptId ? { attemptId: opts.attemptId } : {}),
          payload: {
            ...(typeof opts.payload === "function" ? {} : opts.payload ?? {}),
            ...(opts.commandId ? { commandId: opts.commandId } : {}),
          },
        },
        duplicate: true,
      };
    }
    opts.validate?.(snapshot);
    const at = now();
    const payload = typeof opts.payload === "function"
      ? opts.payload(snapshot, at)
      : opts.payload ?? {};
    const event: KanbanEvent = {
      seq: snapshot.lastAppliedSeq + 1,
      id: opts.commandId ?? makeId("evt"),
      at,
      type,
      actor,
      ...(opts.cardId ? { cardId: opts.cardId } : {}),
      ...(opts.attemptId ? { attemptId: opts.attemptId } : {}),
      payload: {
        ...payload,
        ...(opts.commandId ? { commandId: opts.commandId } : {}),
      },
    };
    await appendEvent(event);
    applyEvent(snapshot, event);
    if (opts.commandId) snapshot.processedCommands = [...snapshot.processedCommands, opts.commandId].slice(-2_000);
    await writeSnapshot(snapshot);
    cached = snapshot;
    publishKanbanEvent(event);
    return { snapshot: cloneSnapshot(snapshot), event, duplicate: false };
  }));
}

/**
 * @deprecated Phase 09 single-write cutover: JSONL store is shadow/fallback only.
 * Canonical board state is projected from the Go control plane / event spine.
 */
export async function listCards(): Promise<WorkItem[]> {
  return cloneSnapshot(await loadSnapshot()).cards.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getCard(id: string): Promise<WorkItem | null> {
  if (!ID_RE.test(id)) return null;
  return cloneSnapshot(await loadSnapshot()).cards.find((card) => card.id === id) ?? null;
}

export async function createCard(input: CreateCardInput, actor: KanbanActor = "user"): Promise<WorkItem> {
  const title = String(input.title ?? "").trim();
  if (!title) throw new KanbanStoreError("Card title is required.");
  const at = now();
  const card: WorkItem = {
    id: makeId("card"),
    title: title.slice(0, 160),
    brief: String(input.brief ?? "").trim().slice(0, 12_000),
    workflowStage: input.workflowStage ?? "backlog",
    runtimeState: input.runtimeState ?? "idle",
    source: input.source ?? { kind: "manual" },
    attempts: [],
    links: input.links ?? {},
    createdAt: at,
    updatedAt: at,
    stageChangedAt: at,
    ...(input.note ? { note: String(input.note).slice(0, 2_000) } : {}),
  };
  const result = await commit(actor, "card_created", { cardId: card.id, payload: { card } });
  return result.snapshot.cards.find((c) => c.id === card.id)!;
}

export async function updateCard(
  id: string,
  patch: Partial<Pick<WorkItem, "title" | "brief" | "links" | "note">>,
  actor: KanbanActor = "user",
): Promise<WorkItem> {
  const result = await commit(actor, "card_updated", {
    cardId: id,
    validate(snapshot) {
      if (!snapshot.cards.some((card) => card.id === id)) {
        throw new KanbanStoreError(`No Kanban card "${id}".`, 404);
      }
    },
    payload(snapshot, at) {
      const card = snapshot.cards.find((entry) => entry.id === id)!;
      const next: WorkItem = {
        ...card,
        ...(patch.title !== undefined ? { title: String(patch.title).trim().slice(0, 160) } : {}),
        ...(patch.brief !== undefined ? { brief: String(patch.brief).slice(0, 12_000) } : {}),
        ...(patch.links !== undefined ? { links: { ...card.links, ...patch.links } } : {}),
        ...(patch.note !== undefined ? { note: String(patch.note).slice(0, 2_000) } : {}),
        updatedAt: at,
      };
      return { card: next };
    },
  });
  return result.snapshot.cards.find((c) => c.id === id)!;
}

export async function deleteCard(id: string): Promise<void> {
  await commit("user", "card_deleted", {
    cardId: id,
    validate(snapshot) {
      if (!snapshot.cards.some((card) => card.id === id)) {
        throw new KanbanStoreError(`No Kanban card "${id}".`, 404);
      }
    },
  });
}

export async function transitionCard(request: TransitionRequest): Promise<{ card: WorkItem; duplicate: boolean }> {
  const result = await commit(request.actor, "workflow_transition", {
    cardId: request.cardId,
    attemptId: request.attemptId,
    commandId: request.commandId,
    validate(snapshot) {
      const card = snapshot.cards.find((entry) => entry.id === request.cardId);
      if (!card) throw new KanbanStoreError(`No Kanban card "${request.cardId}".`, 404);
      if (request.actor === "owner" || request.actor === "reviewer") {
        if (!request.attemptId || request.attemptId !== card.activeAttemptId) {
          throw new KanbanStoreError("This transition does not belong to the active attempt.", 409);
        }
      }
      const invalid = validateTransition(card.workflowStage, request.to, request.actor);
      if (invalid) throw new KanbanStoreError(invalid, 409);
    },
    payload(snapshot) {
      const card = snapshot.cards.find((entry) => entry.id === request.cardId)!;
      return {
        from: card.workflowStage,
        to: request.to,
        ...(request.note ? { note: request.note } : {}),
      };
    },
  });
  return { card: result.snapshot.cards.find((c) => c.id === request.cardId)!, duplicate: result.duplicate };
}

export async function setRuntime(
  cardId: string,
  runtimeState: RuntimeState,
  actor: KanbanActor,
  note?: string,
): Promise<WorkItem> {
  const result = await commit(actor, "runtime_changed", {
    cardId,
    validate(snapshot) {
      if (!snapshot.cards.some((card) => card.id === cardId)) {
        throw new KanbanStoreError(`No Kanban card "${cardId}".`, 404);
      }
    },
    payload: { runtimeState, ...(note ? { note } : {}) },
  });
  return result.snapshot.cards.find((c) => c.id === cardId)!;
}

export async function createAttempt(
  cardId: string,
  input: { builderId: string; role: KanbanAttempt["role"]; effort?: string; sessionId?: string },
): Promise<KanbanAttempt> {
  if (!ID_RE.test(input.builderId)) throw new KanbanStoreError("Bad builder id.");
  const attempt: KanbanAttempt = {
    id: makeId("attempt"),
    builderId: input.builderId,
    role: input.role,
    status: "queued",
    ...(input.effort ? { effort: input.effort } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
  };
  await commit("firstmate", "attempt_created", {
    cardId,
    attemptId: attempt.id,
    validate(snapshot) {
      if (!snapshot.cards.some((card) => card.id === cardId)) {
        throw new KanbanStoreError(`No Kanban card "${cardId}".`, 404);
      }
    },
    payload: { attempt },
  });
  return attempt;
}

export async function bindAttemptSession(
  cardId: string,
  attemptId: string,
  sessionId: string,
): Promise<KanbanAttempt> {
  return updateAttempt(cardId, attemptId, { sessionId }, "system");
}

export async function updateAttempt(
  cardId: string,
  attemptId: string,
  patch: Partial<KanbanAttempt>,
  actor: KanbanActor = "system",
): Promise<KanbanAttempt> {
  const safePatch: Partial<KanbanAttempt> = { ...patch };
  if (patch.status && !(ATTEMPT_STATUSES as readonly string[]).includes(patch.status)) {
    throw new KanbanStoreError("Bad attempt status.");
  }
  const result = await commit(actor, "attempt_updated", {
    cardId,
    attemptId,
    validate(snapshot) {
      const attempt = snapshot.cards.find((card) => card.id === cardId)
        ?.attempts.find((entry) => entry.id === attemptId);
      if (!attempt) throw new KanbanStoreError("Attempt not found.", 404);
      const terminal = attempt.status === "succeeded"
        || attempt.status === "failed"
        || attempt.status === "stopped";
      if (terminal) throw new KanbanStoreError("A terminal attempt cannot be rewritten; create a retry.", 409);
    },
    payload: { patch: safePatch },
  });
  return result.snapshot.cards.find((c) => c.id === cardId)!.attempts.find((a) => a.id === attemptId)!;
}

export async function findAttempt(
  attemptId: string,
): Promise<{ card: WorkItem; attempt: KanbanAttempt } | null> {
  if (!ID_RE.test(attemptId)) return null;
  for (const card of await listCards()) {
    const attempt = card.attempts.find((entry) => entry.id === attemptId);
    if (attempt) return { card, attempt };
  }
  return null;
}

export async function getEvents(
  since = 0,
  opts: { cardId?: string; limit?: number; before?: number } = {},
): Promise<KanbanEvent[]> {
  const limit = Math.min(500, Math.max(1, opts.limit ?? 100));
  const events = await readEventsAfter(Math.max(0, since));
  const filtered = events.filter((event) =>
    (!opts.cardId || event.cardId === opts.cardId)
    && (!Number.isFinite(opts.before) || event.seq < Number(opts.before)));
  return opts.before !== undefined || since === 0
    ? filtered.slice(-limit)
    : filtered.slice(0, limit);
}

export async function migrateLegacyCards(
  migrationId: string,
  legacyCards: unknown[],
): Promise<{ cards: WorkItem[]; applied: boolean }> {
  if (!ID_RE.test(migrationId)) throw new KanbanStoreError("Bad migration id.");
  const stageMap: Record<string, WorkflowStage> = {
    queued: "backlog",
    building: "doing",
    reviewing: "ready2review",
    done: "archived",
    rejected: "todo",
  };
  const cards: WorkItem[] = [];
  for (const raw of legacyCards.slice(0, 300)) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const title = String(item.title ?? "").trim();
    if (!title) continue;
    const at = now();
    cards.push({
      id: `import-${migrationId}-${cards.length}`.slice(0, 80),
      title: title.slice(0, 160),
      brief: String(item.brief ?? "").slice(0, 12_000),
      workflowStage: stageMap[String(item.stage ?? "")] ?? "backlog",
      runtimeState: item.stage === "building" ? "stopped" : "idle",
      source: { kind: "import" },
      attempts: [],
      links: typeof item.id === "string" ? { artifactId: item.id } : {},
      createdAt: at,
      updatedAt: at,
      stageChangedAt: at,
      ...(item.stage === "done" ? { doneAt: at } : {}),
      ...(item.stage === "rejected" ? { note: String(item.note ?? "Imported rejected card.") } : {}),
    });
  }
  const result = await commit("system", "migration_applied", {
    commandId: `migration-${migrationId}`,
    payload: { migrationId, cards },
  });
  return { cards: result.snapshot.cards, applied: !result.duplicate };
}

/** Tests that change AGENTIC_OS_HOME after imports need an explicit reset. */
export function resetKanbanStoreCache(): void { cached = null; }
