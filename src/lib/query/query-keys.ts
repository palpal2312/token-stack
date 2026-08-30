/**
 * Typed workspace/entity query key factories (Phase 19a U1, query contract).
 *
 * One NEWS OS query cache owns server/client state; components never hand-build
 * string keys. Every factory is workspace-scoped and entity-scoped so keys are
 * stable, cacheable, and invalidatable by scope.
 *
 * This is VIEW/READ authority only. Conversation/session state itself stays
 * canonical under Phase 8b durable SEN IDs — the keys here locate cached reads
 * of that state, they never re-author session identity.
 *
 * Pure module: no React, no Next.js, no DOM — unit-testable under node:test.
 */

/** Canonical-ish workspace scope token (server authority remains the workspace id). */
export type WorkspaceScope = string;

/** One stable serialized query key. */
export type QueryKey = readonly unknown[];

/** Root namespace for all NEWS OS query keys. */
const root = "agentos" as const;

/**
 * Build a workspace-scoped, entity-scoped key. Entity ids are appended so a
 * cache can address a single entity without scanning its whole list.
 */
const key = (...parts: unknown[]): QueryKey => [root, ...parts];

/** session/thread/chatAttempt/kanban/runtime factories (Phase 19a QueryKeyFactory). */
export const queryKeys = {
  workspace: (workspaceId: WorkspaceScope) => key("workspace", workspaceId),

  sessions: {
    all: (workspaceId: WorkspaceScope) => key("workspace", workspaceId, "sessions"),
    detail: (workspaceId: WorkspaceScope, sessionId: string) =>
      key("workspace", workspaceId, "sessions", sessionId),
    // Active / ordered list scope used by the SEN surface coordinator.
    active: (workspaceId: WorkspaceScope) => key("workspace", workspaceId, "sessions", "active"),
  },

  thread: {
    detail: (workspaceId: WorkspaceScope, sessionId: string) =>
      key("workspace", workspaceId, "sessions", sessionId, "thread"),
    page: (workspaceId: WorkspaceScope, sessionId: string, cursor: string) =>
      key("workspace", workspaceId, "sessions", sessionId, "thread", "page", cursor),
  },

  chatAttempt: {
    detail: (workspaceId: WorkspaceScope, attemptId: string) =>
      key("workspace", workspaceId, "chat-attempt", attemptId),
    list: (workspaceId: WorkspaceScope) => key("workspace", workspaceId, "chat-attempt"),
    // Pending derivable state stays derived from the canonical active attempt.
    active: (workspaceId: WorkspaceScope) => key("workspace", workspaceId, "chat-attempt", "active"),
  },

  kanban: {
    list: (workspaceId: WorkspaceScope) => key("workspace", workspaceId, "kanban"),
    board: (workspaceId: WorkspaceScope, boardId: string) =>
      key("workspace", workspaceId, "kanban", boardId),
    card: (workspaceId: WorkspaceScope, cardId: string, boardId?: string) =>
      key("workspace", workspaceId, "kanban", "card", ...(boardId ? [boardId] : []), cardId),
    activity: (workspaceId: WorkspaceScope) => key("workspace", workspaceId, "kanban", "activity"),
  },

  runtime: {
    attempts: (workspaceId: WorkspaceScope) => key("workspace", workspaceId, "runtime", "attempts"),
    snapshot: (workspaceId: WorkspaceScope) => key("workspace", workspaceId, "runtime", "snapshot"),
  },
} as const;

/**
 * Prefix-safe cache hash. Elements are JSON-escaped and NUL-delimited so an
 * entity-scoped key is a true string prefix of every descendant scope (and
 * never of a divergent sibling id).
 */
export function serializeQueryKey(qk: QueryKey): string {
  return qk.map((part) => JSON.stringify(part)).join(String.fromCharCode(0));
}