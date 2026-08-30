import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { readRuntimeSlots } from "../go-builder-exec-client";

const clientSource = readFileSync(path.join(import.meta.dirname, "..", "go-builder-exec-client.ts"), "utf8");
const viewSource = readFileSync(
  path.join(import.meta.dirname, "..", "..", "..", "components", "CodeSpaceView.tsx"),
  "utf8",
);

test("readRuntimeSlots populates parsed DTO from the daemon slots path", async () => {
  const originalFetch = globalThis.fetch;
  const originalURL = process.env.SEN_DAEMON_URL;
  let requestedURL = "";
  let requestedInit: RequestInit | undefined;
  process.env.SEN_DAEMON_URL = "http://127.0.0.1:4738";
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requestedURL = String(input);
    requestedInit = init;
    return Response.json({
      dto_version: 1,
      lab_enabled: true,
      slots: [{
        slot_id: "orca-lab",
        state: "running",
        capacity: 1,
        in_flight: 1,
        builder_label: "fixture",
        attempt_ref: "lab-orca-fixture-attempt",
        last_observed_at: "2026-08-21T00:00:00.000Z",
        reason: "running",
        command: "claude --dangerous",
        token: "sk-secret-value",
      }],
    });
  }) as typeof fetch;

  try {
    const dto = await readRuntimeSlots();
    assert.equal(requestedURL, "http://127.0.0.1:4738/api/v1/runtime/slots");
    assert.equal(requestedInit?.method, "GET");
    assert.equal(requestedInit?.cache, "no-store");
    assert.equal(dto.lab_enabled, true);
    assert.equal(dto.slots[0]?.slot_id, "orca-lab");
    assert.equal(dto.slots[0]?.state, "running");
    assert.ok(!JSON.stringify(dto).includes("sk-secret-value"));
    assert.ok(!JSON.stringify(dto).includes("--dangerous"));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalURL === undefined) delete process.env.SEN_DAEMON_URL;
    else process.env.SEN_DAEMON_URL = originalURL;
  }
});

test("readRuntimeSlots does not spawn a background interval", async () => {
  const originalFetch = globalThis.fetch;
  const originalInterval = globalThis.setInterval;
  let intervalCalls = 0;
  globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
    intervalCalls += 1;
    return originalInterval(...args);
  }) as typeof setInterval;
  globalThis.fetch = (async () => Response.json({
    dto_version: 1,
    lab_enabled: false,
    slots: [],
  })) as typeof fetch;
  try {
    await readRuntimeSlots();
    assert.equal(intervalCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setInterval = originalInterval;
  }
});

test("CodeSpace load cycle fetches /api/herdr/slots beside snapshot without a second poller", () => {
  assert.match(viewSource, /fetch\("\/api\/herdr\/slots"/);
  assert.match(viewSource, /Promise\.all/);
  assert.match(viewSource, /cachedFetchJson\([\s\S]*\/api\/herdr\/snapshot/);
  assert.equal((viewSource.match(/setInterval/g) ?? []).length, 0);
  assert.equal((viewSource.match(/EventSource/g) ?? []).length, 0);
  assert.equal((viewSource.match(/fetch\("\/api\/herdr\/slots"/g) ?? []).length, 1);
  assert.doesNotMatch(clientSource, /setInterval/);
  assert.doesNotMatch(clientSource, /EventSource/);
});
