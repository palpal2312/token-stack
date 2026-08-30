import assert from "node:assert/strict";
import test from "node:test";
import { queryKeys, serializeQueryKey } from "../../src/lib/query/query-keys";

test("query keys are namespaced, workspace-scoped, and entity-scoped", () => {
  const ws = "workspace-1";
  const session = "session-9";
  const attempt = "attempt-2";

  assert.deepEqual(queryKeys.workspace(ws), ["agentos", "workspace", ws]);
  assert.deepEqual(queryKeys.sessions.all(ws), ["agentos", "workspace", ws, "sessions"]);
  assert.deepEqual(queryKeys.sessions.detail(ws, session), ["agentos", "workspace", ws, "sessions", session]);
  assert.deepEqual(queryKeys.thread.detail(ws, session), ["agentos", "workspace", ws, "sessions", session, "thread"]);
  assert.deepEqual(queryKeys.chatAttempt.detail(ws, attempt), ["agentos", "workspace", ws, "chat-attempt", attempt]);
  assert.deepEqual(queryKeys.kanban.card(ws, "card-5", "board-1"), ["agentos", "workspace", ws, "kanban", "card", "board-1", "card-5"]);
  assert.deepEqual(queryKeys.runtime.snapshot(ws), ["agentos", "workspace", ws, "runtime", "snapshot"]);
});

test("separate workspaces never collide on the same entity id", () => {
  assert.notEqual(
    serializeQueryKey(queryKeys.sessions.detail("wsA", "s1")),
    serializeQueryKey(queryKeys.sessions.detail("wsB", "s1")),
    "workspace scope must separate identical entity ids",
  );
});

test("prefixes let an entity-scoped write invalidate descendant scopes", () => {
  const ws = "w";
  const session = "s1";
  const parent = queryKeys.sessions.detail(ws, session); // [... sessions, session]
  const child = queryKeys.thread.page(ws, session, "c0"); // [... sessions, session, thread, page, c0]

  const parentHash = serializeQueryKey(parent);
  const childHash = serializeQueryKey(child);
  assert.ok(childHash.startsWith(parentHash), "thread/page must nest under the session detail key");
  // A session write clears its thread scopes.
  assert.ok(childHash.startsWith(serializeQueryKey(queryKeys.sessions.detail(ws, session))));
});

test("serializeQueryKey is deterministic and unique", () => {
  assert.equal(
    serializeQueryKey(queryKeys.runtime.attempts("w")),
    serializeQueryKey(queryKeys.runtime.attempts("w")),
    "same key serializes deterministically",
  );
  assert.notEqual(
    serializeQueryKey(queryKeys.sessions.detail("a", "s1")),
    serializeQueryKey(queryKeys.sessions.detail("a", "s12")),
    "a divergent trailing element must produce a different hash",
  );
});