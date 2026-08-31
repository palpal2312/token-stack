import assert from "node:assert/strict";
import test from "node:test";

import {
  eventText,
  formatTerminalOutcome,
  hasEventGap,
  isTerminalAttemptState,
  mergeEventsBySeq,
  newSessionId,
  terminalStateFromEvent,
  type ChatStreamEvent,
} from "../chat-client";

function event(seq: number, kind = "progress", text = `t${seq}`): ChatStreamEvent {
  return {
    chatAttemptId: "ca-1",
    seq,
    eventKind: kind,
    payload: { kind, text },
    redactionClass: "local_sensitive",
    recordedAt: "2026-08-10T00:00:00Z",
  };
}

test("mergeEventsBySeq dedupes by seq and orders", () => {
  const seen = new Map<number, ChatStreamEvent>();
  mergeEventsBySeq(seen, [event(1), event(2)]);
  // A refetched tail overlapping the known range must not duplicate.
  const merged = mergeEventsBySeq(seen, [event(2, "progress", "CHANGED"), event(3)]);
  assert.equal(merged.length, 3);
  assert.deepEqual(merged.map((e) => e.seq), [1, 2, 3]);
  // The first write wins: no overwrite of an applied seq.
  assert.equal(eventText(merged[1]), "t2");
});

test("hasEventGap detects missing replay sequences", () => {
  assert.equal(hasEventGap(0, [event(1), event(2)]), false);
  assert.equal(hasEventGap(2, [event(2), event(3)]), false);
  assert.equal(hasEventGap(2, [event(4)]), true);
  assert.equal(hasEventGap(0, [event(1), event(3)]), true);
  assert.equal(hasEventGap(0, []), false);
});

test("eventText extracts normalized payload text", () => {
  assert.equal(eventText(event(1, "thinking", "hmm")), "hmm");
  assert.equal(eventText({ ...event(1), payload: null }), "");
  assert.equal(eventText({ ...event(1), payload: { kind: "progress" } }), "");
});

test("newSessionId uses the canonical s- prefix", () => {
  const id = newSessionId();
  assert.match(id, /^s-[0-9a-f-]{36}$/);
  assert.notEqual(newSessionId(), newSessionId());
});

test("formatTerminalOutcome covers failure/cancel/no-response/success display", () => {
  assert.equal(formatTerminalOutcome("succeeded"), "Turn completed.");
  assert.equal(formatTerminalOutcome("failed"), "Turn failed.");
  assert.equal(formatTerminalOutcome("cancelled"), "Turn cancelled.");
  assert.equal(formatTerminalOutcome("no_response"), "No response from the builder.");
  assert.match(formatTerminalOutcome("weird"), /weird/);
  assert.equal(isTerminalAttemptState("failed"), true);
  assert.equal(isTerminalAttemptState("running"), false);
});

test("terminalStateFromEvent reads payload state for terminal display", () => {
  assert.equal(
    terminalStateFromEvent({
      chatAttemptId: "ca-1",
      seq: 9,
      eventKind: "terminal",
      payload: { state: "no_response" },
      redactionClass: "local_sensitive",
      recordedAt: "r",
    }),
    "no_response",
  );
  assert.equal(
    terminalStateFromEvent({
      chatAttemptId: "ca-1",
      seq: 9,
      eventKind: "progress",
      payload: { text: "still going" },
      redactionClass: "local_sensitive",
      recordedAt: "r",
    }),
    null,
  );
});

test("senChatQueryKeys expose workspace-scoped session/thread/attempt factories", async () => {
  const { senChatQueryKeys } = await import("../chat-query-keys");
  const ws = "ws-1";
  assert.deepEqual(senChatQueryKeys.sessions.active(ws), ["agentos", "workspace", ws, "sessions", "active"]);
  assert.deepEqual(senChatQueryKeys.thread.detail(ws, "s-1"), ["agentos", "workspace", ws, "sessions", "s-1", "thread"]);
  assert.deepEqual(senChatQueryKeys.chatAttempt.active(ws), ["agentos", "workspace", ws, "chat-attempt", "active"]);
});
