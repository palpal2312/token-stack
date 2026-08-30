/**
 * Canonical SEN Chat query-key surface (S03-L2-001).
 *
 * Re-exports the Phase 19a workspace-scoped factories for session/thread/
 * chatAttempt so the Lane 2 client stack has one ownership-local import path.
 * These keys locate cached reads only — they never author conversation
 * identity (that stays with durable SEN IDs from the typed chat client).
 */
import { queryKeys, type QueryKey, type WorkspaceScope } from "@/lib/query/query-keys";

export type { QueryKey, WorkspaceScope };

export const senChatQueryKeys = {
  sessions: queryKeys.sessions,
  thread: queryKeys.thread,
  chatAttempt: queryKeys.chatAttempt,
} as const;
