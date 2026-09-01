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

test("keeps the raw shape untouched when not canonical (pass-through path)", () => {
  const raw = { error: "sen daemon unreachable" };
  assert.equal(mapCanonicalChatReceipt(raw as never), undefined as never, "guard is in the route");
});