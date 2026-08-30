import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../route";

const DISABLED = { dto_version: 1, lab_enabled: false, slots: [] };

const VALID_SLOT = {
  slot_id: "orca-lab",
  state: "free",
  capacity: 1,
  in_flight: 0,
  builder_label: null,
  attempt_ref: null,
  last_observed_at: "2026-08-18T00:00:00.000Z",
  reason: null,
};

async function withMockedFetch<T>(
  impl: typeof fetch,
  run: () => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  const originalURL = process.env.SEN_DAEMON_URL;
  process.env.SEN_DAEMON_URL = "http://127.0.0.1:4738";
  globalThis.fetch = impl;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
    if (originalURL === undefined) delete process.env.SEN_DAEMON_URL;
    else process.env.SEN_DAEMON_URL = originalURL;
  }
}

test("daemon 200 with extra wire fields -> 200 sanitized DTO", async () => {
  const body = await withMockedFetch(async () => Response.json({
    dto_version: 1,
    lab_enabled: true,
    slots: [{
      ...VALID_SLOT,
      command: "claude --dangerous",
      token: "sk-secret-value",
      auth_path: "C:\\Users\\x\\.config\\claude",
      env: { ANTHROPIC_API_KEY: "sk-secret-value" },
    }],
  }), async () => {
    const res = await GET();
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    return res.json();
  });
  assert.equal(body.dto_version, 1);
  assert.equal(body.lab_enabled, true);
  assert.equal(body.slots.length, 1);
  assert.equal(body.slots[0].slot_id, "orca-lab");
  const wire = JSON.stringify(body);
  assert.ok(!wire.includes("sk-secret-value"));
  assert.ok(!wire.includes("--dangerous"));
  assert.ok(!wire.includes(".config"));
  assert.ok(!("command" in body.slots[0]));
  assert.ok(!("token" in body.slots[0]));
  assert.ok(!("env" in body.slots[0]));
});

test("upstream ECONNREFUSED / unreachable -> 200 disabled payload", async () => {
  const body = await withMockedFetch(async () => {
    throw Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:4738"), { code: "ECONNREFUSED" });
  }, async () => {
    const res = await GET();
    assert.equal(res.status, 200);
    return res.json();
  });
  assert.deepEqual(body, DISABLED);
});

test("upstream 500 -> 200 disabled payload", async () => {
  const body = await withMockedFetch(async () => new Response("internal boom", { status: 500 }), async () => {
    const res = await GET();
    assert.equal(res.status, 200);
    return res.json();
  });
  assert.deepEqual(body, DISABLED);
});

test("version drift -> fail-closed disabled payload", async () => {
  const body = await withMockedFetch(async () => Response.json({
    dto_version: 2,
    lab_enabled: true,
    slots: [VALID_SLOT],
  }), async () => {
    const res = await GET();
    assert.equal(res.status, 200);
    return res.json();
  });
  assert.deepEqual(body, DISABLED);
});
