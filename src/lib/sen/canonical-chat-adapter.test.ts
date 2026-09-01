import { test } from "node:test";
import assert from "node:assert/strict";

import { mapCanonicalChatReceipt } from "./canonical-chat-adapter";

test("maps canonical snake_case receipt to the consumer shape with real PKs", () => {
  const out = mapCanonicalChatReceipt({
    command_id: "cmd-1",
    turn_seq: 3,
    turn_id: "turn-s-1-3",
    chat_attempt_id: "attempt-s-1-3",
    session_id: "s-1",
    status: "queued",
    created_at: "2026-09-01T00:00:00Z",
  });
  assert.equal(out.commandId, "cmd-1");
  assert.equal(out.turnSeq, 3);
  assert.equal(out.turnId, "turn-s-1-3");
  assert.equal(out.chatAttemptId, "attempt-s-1-3");
  assert.equal(out.sessionId, "s-1");
  assert.equal(out.status, "queued");
  assert.equal(out.createdAt, "2026-09-01T00:00:00Z");
});

test("maps a second turn incrementally", () => {
  const out = mapCanonicalChatReceipt({
    command_id: "cmd-2",
    turn_seq: 4,
    turn_id: "turn-s-1-4",
    chat_attempt_id: "attempt-s-1-4",
    session_id: "s-1",
    status: "queued",
    created_at: "2026-09-01T00:00:01Z",
  });
  assert.equal(out.turnSeq, 4);
  assert.equal(out.turnId, "turn-s-1-4");
});