import assert from "node:assert/strict";
import test from "node:test";
import { queryKeys } from "../../src/lib/query/query-keys";
import { QueryClient } from "../../src/lib/query/query-cache";
import {
  AckSeedCoordinator,
  derivePendingFromAttempt,
  pendingKind,
  shouldClearDraft,
  type CommittedChatAck,
} from "../../src/lib/query/ack-seed";

/**
 * Phase 19a U3 — ack-seed + pending/draft semantics (custom, library-free).
 * Pure-engine tests for the Phase 8b committed-ack seeding contract: insert-once
 * by commandId, pending derived from the canonical active attempt (never a
 * second store), draft clearing conditional on the acknowledged compose target,
 * and one ≤1 channel per workspace. Mirrors the established node:test + tsx
 * runner (phase-19a-u3-query-cache.spec.ts / realtime-reconciler.spec.ts).
 */

const ws = "wsA";
function ack(over: Partial<CommittedChatAck> = {}): CommittedChatAck {
  return {
    commandId: "cmd-1",
    sessionId: "s1",
    turnId: "t-1",
    turnSeq: 1,
    chatAttemptId: "at-1",
    status: "running",
    content: "hello",
    ...over,
  };
}

test("insert-once: a replayed commandId never double-inserts the thread turn", () => {
  const client = new QueryClient();
  const c = new AckSeedCoordinator({ workspaceId: ws, client });

  const first = c.seedCommittedAck(ack());
  assert.equal(first, "inserted", "the first ack seeds cleanly");
  assert.equal(c.isSeeded("cmd-1"), true);
  assert.equal(c.seededCount(), 1);

  // A retry of the SAME commandId (persist-before-ack replay via the canonical
  // /api/sen/chat envelope) must be a no-op — never a second copy.
  const replay = c.seedCommittedAck(ack());
  assert.equal(replay, "duplicate", "replayed command id returns duplicate, does not re-insert");
  assert.equal(c.seededCount(), 1);

  const rows = c.threadRows("s1");
  assert.equal(rows.length, 1, "exactly one committed turn, never two");
  assert.equal(rows[0].turnId, "t-1", "the canonical turn id is present");
});

test("seeded cache carries only canonical ids — no optimistic fake ids outside compose", () => {
  const client = new QueryClient();
  const c = new AckSeedCoordinator({ workspaceId: ws, client });
  c.seedCommittedAck(
    ack({ turnId: "t-9", turnSeq: 9, chatAttemptId: "at-9", commandId: "cmd-9", content: "committed" }),
  );

  const thread = c.threadRows("s1");
  assert.equal(thread.length, 1);
  assert.equal(thread[0].turnId, "t-9", "canonical turn id, not a synthetic one");
  assert.equal(thread[0].chatAttemptId, "at-9");
  assert.equal(thread[0].clientCommandId, "cmd-9");

  // The canonical active-attempt record is the pending authority.
  const active = c.activeAttempt("s1");
  assert.equal(active?.chatAttemptId, "at-9");
  assert.equal(active?.state, "running");
  assert.equal(active?.inputFirstTurnSeq, 9);

  // The detail record lives under the entity key.
  const detail = client.getData<{ chatAttemptId: string }>(queryKeys.chatAttempt.detail(ws, "at-9"));
  assert.equal(detail?.chatAttemptId, "at-9", "the attempt detail is the single entity authority");
});

test("pending derives from the canonical attempt — a state change re-derives, no second store", () => {
  const client = new QueryClient();
  const c = new AckSeedCoordinator({ workspaceId: ws, client });
  c.seedCommittedAck(ack());

  const running = c.pendingFor("s1");
  assert.equal(running.pending, true, "a running attempt derives pending");
  assert.equal(running.kind, "active");
  assert.equal(running.chatAttemptId, "at-1");

  // The attempt ADVANCES (canonical replace / stream). Pending must follow the
  // cached canonical record automatically — it is derived, not a stored flag.
  const active = client.getData<Record<string, { state: string }>>(queryKeys.chatAttempt.active(ws))!;
  client.setData(queryKeys.chatAttempt.active(ws), {
    ...active,
    s1: { ...c.activeAttempt("s1")!, state: "succeeded" },
  });

  const done = c.pendingFor("s1");
  assert.equal(done.pending, false, "pending re-derives false once the attempt terminates");
  assert.equal(done.kind, "terminal");

  // A failed attempt is equally terminal (draft still must survive the send).
  client.setData(queryKeys.chatAttempt.active(ws), {
    ...active,
    s1: { ...c.activeAttempt("s1")!, state: "failed" },
  });
  assert.equal(c.pendingFor("s1").pending, false);
  assert.equal(c.pendingFor("s1").kind, "terminal");
});

test("queued/claimed/running classify as pending; terminal/none do not", () => {
  assert.equal(pendingKind("queued"), "queued");
  assert.equal(pendingKind("claimed"), "active");
  assert.equal(pendingKind("running"), "active");
  assert.equal(pendingKind("succeeded"), "terminal");
  assert.equal(pendingKind("failed"), "terminal");
  assert.equal(pendingKind("cancelled"), "terminal");
  assert.equal(pendingKind("no_response"), "terminal");
  assert.equal(pendingKind(undefined), "none");
});

test("derivePendingFromAttempt is pure and yields pending turn seqs", () => {
  const view = derivePendingFromAttempt({
    chatAttemptId: "at-5",
    sessionId: "s1",
    state: "queued",
    inputFirstTurnSeq: 5,
    inputLastTurnSeq: 5,
    updatedAt: 0,
  });
  assert.deepEqual(view.pendingTurnSeqs, [5]);
  assert.equal(view.kind, "queued");
  assert.equal(view.pending, true);

  const none = derivePendingFromAttempt(undefined);
  assert.equal(none.pending, false);
  assert.equal(none.kind, "none");
  assert.equal(none.chatAttemptId, null);
});

test("distinct commandIds/sessions seed independently (both commit)", () => {
  const client = new QueryClient();
  const c = new AckSeedCoordinator({ workspaceId: ws, client });
  c.seedCommittedAck(ack({ commandId: "cmd-1", turnSeq: 1, turnId: "t-1", sessionId: "s1", content: "a" }));
  c.seedCommittedAck(ack({ commandId: "cmd-2", turnSeq: 2, turnId: "t-2", sessionId: "s1", content: "b" }));
  c.seedCommittedAck(ack({ commandId: "cmd-3", turnSeq: 1, turnId: "t-1", sessionId: "s9", content: "a" }));

  assert.equal(c.seededCount(), 3);
  const s1 = c.threadRows("s1");
  assert.equal(s1.length, 2, "two turns in s1");
  assert.equal(s1[1].clientCommandId, "cmd-2");
  const s9 = c.threadRows("s9");
  assert.equal(s9.length, 1, "s9 independent");
});

test("no cross-workspace bleed: the same commandId seeds in two workspaces independently", () => {
  const client = new QueryClient();
  const a = new AckSeedCoordinator({ workspaceId: "wsA", client });
  const b = new AckSeedCoordinator({ workspaceId: "wsB", client });

  assert.equal(a.seedCommittedAck(ack({ commandId: "cmd-x" })), "inserted");
  assert.equal(b.seedCommittedAck(ack({ commandId: "cmd-x" })), "inserted", "per-workspace dedupe");
  assert.equal(a.seededCount(), 1);
  assert.equal(b.seededCount(), 1);
  assert.equal(
    client.getData<Record<string, { chatAttemptId: string }>>(queryKeys.chatAttempt.active("wsA"))?.s1.chatAttemptId,
    "at-1",
  );
  assert.equal(
    client.getData<Record<string, { chatAttemptId: string }>>(queryKeys.chatAttempt.active("wsB"))?.s1.chatAttemptId,
    "at-1",
  );
});

test("draft clearing is conditional on the acknowledged compose target", () => {
  // Same canonical session -> the acknowledged compose target clears its draft.
  assert.equal(shouldClearDraft(ack({ sessionId: "s1" }), { sessionId: "s1" }), true);

  // A background send for a DIFFERENT session must never clear the authoring draft.
  assert.equal(shouldClearDraft(ack({ sessionId: "s2" }), { sessionId: "s1" }), false);

  // The strict-surface variant requires the same surface too.
  assert.equal(shouldClearDraft(ack({ sessionId: "s1" }), { sessionId: "s1", surface: "floating" }), true);
  assert.equal(shouldClearDraft(ack({ sessionId: "s2" }), { sessionId: "s1", surface: "page" }), false);
});

test("a terminal ack (failed) still seeds once but never leaves pending", () => {
  const client = new QueryClient();
  const c = new AckSeedCoordinator({ workspaceId: ws, client });
  c.seedCommittedAck(ack({ commandId: "cmd-f", status: "failed", turnId: "t-f", turnSeq: 3, chatAttemptId: "at-f" }));
  assert.equal(c.seededCount(), 1);
  assert.equal(c.pendingFor("s1").pending, false);
  assert.equal(c.pendingFor("s1").kind, "terminal");
});

test("register is idempotent per coordinator — exactly ≤1 channel", () => {
  const client = new QueryClient();
  const c = new AckSeedCoordinator({ workspaceId: ws, client });
  assert.equal(c.listeners(), 0, "no channel before register");

  const t1 = c.register();
  assert.equal(c.listeners(), 1, "exactly one channel after first register");
  const t2 = c.register();
  assert.equal(c.listeners(), 1, "repeat register never adds a duplicate channel");

  t2();
  assert.equal(c.listeners(), 1, "channel survives until the last registration tears down");
  t1();
  assert.equal(c.listeners(), 0, "channel closes at the last teardown");

  const t3 = c.register();
  assert.equal(c.listeners(), 1, "re-entrant after full teardown");
  t3();
  assert.equal(c.listeners(), 0);
});