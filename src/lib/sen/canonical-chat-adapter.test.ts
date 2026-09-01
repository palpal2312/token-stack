import { test } from "node:test";
import assert from "node:assert/strict";

import { mapCanonicalChatReceipt } from "./canonical-chat-adapter";

test("maps canonical snake_case receipt to the consumer shape", () => {
  const out = mapCanonicalChatReceipt({
    command_id: "cmd-1",
    turn_seq: 3,
    session_id: "s-1",
    created_at: "2026-09-01T00:00:00Z",
  });
  assert.equal(out.commandId, "cmd-1");
  assert.equal(out.turnSeq, 3);
  assert.equal(out.chatAttemptId, "cmd-1");
  assert.equal(out.sessionId, "s-1");
  assert.equal(out.status, "sent");
  assert.equal(out.createdAt, "2026-09-01T00:00:00Z");
});

test("maps a second turn sequence incrementally", () => {
  const out = mapCanonicalChatReceipt({
    command_id: "cmd-2",
    turn_seq: 4,
    session_id: "s-1",
    created_at: "2026-09-01T00:00:01Z",
  });
  assert.equal(out.turnSeq, 4);
  assert.equal(out.createdAt, "2026-09-01T00:00:01Z");
});