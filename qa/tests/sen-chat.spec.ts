// S03-L2 focused spec: the canonical SEN Chat typed client contract.
//
// Proves the browser-facing surface the thin proxies back: persist-before-ack
// send, command-id replay passthrough, cursor thread reads, active-attempt
// recovery (404 -> null), tail events with empty envelopes -> [], and
// error-shape normalization. fetch is mocked at globalThis so the spec runs
// under the plain tsx runner like every other qa/tests spec.
import assert from "node:assert/strict";
import test from "node:test";

import {
  getActiveAttempt,
  getEventsAfter,
  getThread,
  listSessions,
  newCommandId,
  newSessionId,
  retryAttempt,
  sendTurn,
  stopAttempt,
  type ChatAttempt,
  type ChatStreamEvent,
  type SendTurnReceipt,
} from "../../src/lib/sen/chat-client";

type FetchCall = { url: string; init: RequestInit | undefined };

function installFetch(handler: (call: FetchCall) => Response): FetchCall[] {
  const calls: FetchCall[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const call = { url, init };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return calls;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function errorResponse(status: number, message: string): Response {
  return jsonResponse({ error: message }, status);
}

const receipt: SendTurnReceipt = {
  commandId: "cmd-1",
  sessionId: "s-1",
  turnId: "t-1",
  turnSeq: 1,
  chatAttemptId: "ca-1",
  status: "accepted",
};

test("sendTurn posts the canonical envelope and returns the receipt (persist-before-ack)", async () => {
  const calls = installFetch(() => jsonResponse(receipt, 201));
  const result = await sendTurn({ sessionId: "s-1", content: "hello", builderPolicy: "deepseek" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/sen/chat");
  assert.equal(calls[0].init?.method, "POST");
  const body = JSON.parse(calls[0].init?.body as string) as Record<string, unknown>;
  assert.equal(body.sessionId, "s-1");
  assert.equal(body.content, "hello");
  assert.equal(body.builderPolicy, "deepseek");
  assert.equal(typeof body.commandId, "string");
  assert.deepEqual(result, receipt);
});

test("sendTurn mints an s- session id when the caller has none", async () => {
  const calls = installFetch(() => jsonResponse(receipt, 201));
  await sendTurn({ content: "new chat" });
  const body = JSON.parse(calls[0].init?.body as string) as Record<string, unknown>;
  assert.match(body.sessionId as string, /^s-[0-9a-f-]{36}$/);
});

test("sendTurn replays the caller's commandId verbatim (retry key, not a fresh uuid)", async () => {
  const calls = installFetch(() => jsonResponse(receipt, 201));
  const commandId = newCommandId();
  await sendTurn({ sessionId: "s-1", content: "hi", commandId });
  await sendTurn({ sessionId: "s-1", content: "hi", commandId });
  assert.equal(calls.length, 2);
  for (const call of calls) {
    const body = JSON.parse(call.init?.body as string) as Record<string, string>;
    assert.equal(body.commandId, commandId);
  }
});

test("sendTurn surfaces the proxy error message on non-ok", async () => {
  installFetch(() => errorResponse(400, "content is required"));
  await assert.rejects(sendTurn({ sessionId: "s-1", content: "" }), /content is required/);
});

test("listSessions returns the canonical session list and flag", async () => {
  const sessions = [{ sessionId: "s-1", workspaceId: "ws", title: "T", status: "active", selectedBuilderPolicy: "deepseek", version: 1, createdAt: "c", updatedAt: "u" }];
  const calls = installFetch(() => jsonResponse({ sessions, canonical: true }));
  const result = await listSessions();
  assert.equal(calls[0].url, "/api/sen/chat");
  assert.equal(result.canonical, true);
  assert.deepEqual(result.sessions, sessions);
});

test("getThread builds the after_seq cursor and parses the thread", async () => {
  const turns = [{ turnId: "t-1", turnSeq: 1, sessionId: "s-1", role: "user", messageKind: "chat", content: "hi", chatAttemptId: "ca-1", clientCommandId: "cmd-1", recordedAt: "r" }];
  const calls = installFetch(() => jsonResponse({ sessionId: "s-1", turns, nextAfterSeq: 2 }));
  const result = await getThread("s-1", 2, 50);
  assert.equal(calls[0].url, "/api/sen/chat/sessions/s-1/thread?after_seq=2&limit=50");
  assert.equal(result.nextAfterSeq, 2);
  assert.deepEqual(result.turns, turns);
});

test("getThread URL-encodes the session id", async () => {
  const calls = installFetch(() => jsonResponse({ sessionId: "a/b", turns: [], nextAfterSeq: 0 }));
  await getThread("a/b");
  assert.equal(calls[0].url, "/api/sen/chat/sessions/a%2Fb/thread?after_seq=0&limit=200");
});

test("getActiveAttempt returns null on 404 and the attempt on 200", async () => {
  const attempt: ChatAttempt = {
    chatAttemptId: "ca-1",
    sessionId: "s-1",
    inputFirstTurnSeq: 1,
    inputLastTurnSeq: 1,
    ordinal: 1,
    state: "running",
    builderId: "b",
    leaseOwner: "w",
    leaseGeneration: 1,
    version: 1,
    createdAt: "c",
    updatedAt: "u",
  };
  const calls: FetchCall[] = [];
  let mode: "404" | "200" = "404";
  installFetch((call) => {
    calls.push(call);
    return mode === "404" ? jsonResponse({}, 404) : jsonResponse(attempt);
  });
  assert.equal(await getActiveAttempt("s-1"), null);
  mode = "200";
  assert.deepEqual(await getActiveAttempt("s-1"), attempt);
  assert.equal(calls[0].url, "/api/sen/chat/sessions/s-1/active");
});

test("getEventsAfter tolerates an empty/null event envelope (reconnect tail no-op)", async () => {
  const calls = installFetch(() => jsonResponse({ events: null }));
  assert.deepEqual(await getEventsAfter("ca-1", 5, 200), []);
  assert.equal(calls[0].url, "/api/sen/chat/attempts/ca-1/events?after_seq=5&limit=200");
});

test("getEventsAfter returns the parsed tail", async () => {
  const events: ChatStreamEvent[] = [
    { chatAttemptId: "ca-1", seq: 1, eventKind: "progress", payload: { kind: "progress", text: "a" }, redactionClass: "local_sensitive", recordedAt: "r" },
  ];
  installFetch(() => jsonResponse({ events }));
  assert.deepEqual(await getEventsAfter("ca-1"), events);
});

test("newSessionId and newCommandId stay distinct and unique", () => {
  const ids = { s1: newSessionId(), s2: newSessionId(), c1: newCommandId(), c2: newCommandId() };
  assert.notEqual(ids.s1, ids.s2);
  assert.notEqual(ids.c1, ids.c2);
  assert.match(ids.s1, /^s-/);
  assert.doesNotMatch(ids.c1, /^s-/);
});

test("a non-JSON error body falls back to the HTTP status", async () => {
  installFetch(() => new Response("boom", { status: 502 }));
  await assert.rejects(sendTurn({ sessionId: "s-1", content: "x" }), /HTTP 502/);
});
test("stopAttempt posts the thin stop proxy with a commandId (cancel path)", async () => {
  const calls = installFetch(() => jsonResponse({ commandId: "c-stop", chatAttemptId: "ca-1", status: "cancelled" }));
  const commandId = newCommandId();
  const result = await stopAttempt("ca-1", commandId);
  assert.equal(calls[0].url, "/api/sen/chat/attempts/ca-1/stop");
  assert.equal(calls[0].init?.method, "POST");
  const body = JSON.parse(calls[0].init?.body as string) as { commandId: string };
  assert.equal(body.commandId, commandId);
  assert.equal(result.status, "cancelled");
});

test("retryAttempt posts the thin retry proxy (duplicate ACK key passthrough)", async () => {
  const calls = installFetch(() => jsonResponse({ commandId: "c-retry", chatAttemptId: "ca-1", status: "queued" }));
  const commandId = "ack-dup-1";
  await retryAttempt("ca-1", commandId);
  await retryAttempt("ca-1", commandId);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "/api/sen/chat/attempts/ca-1/retry");
  for (const call of calls) {
    const body = JSON.parse(call.init?.body as string) as { commandId: string };
    assert.equal(body.commandId, commandId);
  }
});

test("reload recovery: getActiveAttempt null means no pending tail (empty-cache rebuild path)", async () => {
  installFetch(() => jsonResponse({}, 404));
  assert.equal(await getActiveAttempt("s-reload"), null);
});
