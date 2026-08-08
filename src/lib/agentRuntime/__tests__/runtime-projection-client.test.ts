import assert from "node:assert/strict";
import test from "node:test";
import { readRuntimeProjection } from "../go-builder-exec-client";

test("readRuntimeProjection returns the typed daemon projection", async () => {
  const originalFetch = globalThis.fetch;
  const originalURL = process.env.SEN_DAEMON_URL;
  let requestedURL = "";
  let requestedInit: RequestInit | undefined;
  process.env.SEN_DAEMON_URL = "http://127.0.0.1:4738";
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requestedURL = String(input);
    requestedInit = init;
    return Response.json({
      projection_version: "v1",
      attempts: [{
        attempt_id: "attempt-1",
        task_id: "task-1",
        builder_id: "builder-1",
        pane_id: "pane-1",
        status: "attached",
        lease_generation: 1,
        attached_at: "2026-08-07T12:00:00Z",
        last_heartbeat_at: "2026-08-07T12:00:15Z",
        terminal_at: "0001-01-01T00:00:00Z",
      }],
    });
  }) as typeof fetch;

  try {
    const result = await readRuntimeProjection();
    assert.equal(requestedURL, "http://127.0.0.1:4738/api/v1/runtime/attempts");
    assert.equal(requestedInit?.method, "GET");
    assert.equal(requestedInit?.cache, "no-store");
    assert.equal(result.attempts[0]?.status, "attached");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalURL === undefined) delete process.env.SEN_DAEMON_URL;
    else process.env.SEN_DAEMON_URL = originalURL;
  }
});

test("readRuntimeProjection fails closed on invalid response elements", async () => {
  const originalFetch = globalThis.fetch;
  const responses = [
    { attempts: "not-an-array" },
    { projection_version: "v1", attempts: [null] },
    { projection_version: "v1", attempts: [{ status: "attached" }] },
  ];
  try {
    for (const response of responses) {
      globalThis.fetch = (async () => Response.json(response)) as typeof fetch;
      await assert.rejects(readRuntimeProjection(), /invalid runtime projection response/);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("readRuntimeProjection preserves daemon HTTP failure details", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('{"error":"projection unavailable"}', { status: 503 })) as typeof fetch;
  try {
    await assert.rejects(readRuntimeProjection(), /HTTP 503.*projection unavailable/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
