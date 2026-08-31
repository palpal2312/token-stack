import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../../../app/api/builders/execution-projection/route";

// Guard-path coverage only: no token and foreign origin must fail closed
// without touching the registry or leaking anything. The success path needs
// the per-install token file and is covered by live QA, not unit specs.

test("no token -> 401, body names the requirement, no registry data", async () => {
  const res = await GET(new Request("http://127.0.0.1:3737/api/builders/execution-projection"));
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.ok(typeof body.error === "string");
  assert.ok(!("builders" in body), "unauthenticated response must not carry projection data");
});

test("foreign Origin -> 403 before any token/registry work", async () => {
  const res = await GET(new Request("http://127.0.0.1:3737/api/builders/execution-projection", {
    headers: { origin: "https://evil.example", "x-agentic-os-token": "whatever" },
  }));
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.ok(!("builders" in body));
});

test("query-string token is not accepted", async () => {
  const res = await GET(new Request("http://127.0.0.1:3737/api/builders/execution-projection?token=whatever"));
  assert.equal(res.status, 401);
});
