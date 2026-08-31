import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

// Hermetic success/error-path integration for the PX route: a temp
// AGENTIC_OS_HOME with a known token file lets the real guard pass, so the
// 200/409 paths are exercised without touching the user's registry.
// (node --test isolates each file in its own subprocess, so the env set below
// cannot leak into sibling specs.)

const home = mkdtempSync(path.join(tmpdir(), "px-route-test-"));
process.env.AGENTIC_OS_HOME = home;

const TOKEN = "a".repeat(64);
writeFileSync(path.join(home, "api-token"), TOKEN + "\n");

const SECRET = "sk-route-test-secret-abcdef0123456789";
const SECRET_BUILDER = {
  id: "claude-kimi",
  cli: "claude",
  name: "Claude via Kimi",
  auth: { kind: "api", configDir: path.join(home, "builders", "claude-kimi"), env: { ANTHROPIC_API_KEY: SECRET } },
  env: { ROUTE_MARKER: "route-marker-value" },
  bin: null,
  args: ["--raw-arg"],
  model: "kimi-k2",
  isDefault: true,
  notes: `notes with ${SECRET}`,
  createdAt: "2026-08-17T00:00:00.000Z",
};

async function freshGET() {
  // Unique query defeats any module cache so each test gets a clean graph.
  const mod = await import(`../../../app/api/builders/execution-projection/route.ts?case=${Math.random()}`);
  return mod.GET as (req: Request) => Promise<Response>;
}

function authed(url = "http://127.0.0.1:3737/api/builders/execution-projection") {
  return new Request(url, { headers: { "x-agentic-os-token": TOKEN } });
}

test("valid token + absent registry -> 200 with empty projection", async () => {
  const GET = await freshGET();
  const res = await GET(authed());
  // Absent builders.json triggers first-run seeding of host CLIs; either an
  // empty list or seeded entries is fine — the contract is shape, not count.
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.projectionRevision, 1);
  assert.ok(Array.isArray(body.builders));
});

test("valid token + secret-bearing registry -> 200, wire carries no secret/path/notes/args", async () => {
  writeFileSync(path.join(home, "builders.json"), JSON.stringify({ version: 1, builders: [SECRET_BUILDER] }) + "\n");
  const GET = await freshGET();
  const res = await GET(authed());
  assert.equal(res.status, 200);
  const text = JSON.stringify(await res.json());
  assert.ok(!text.includes(SECRET), "secret on wire");
  assert.ok(!text.includes("route-marker-value"), "env value on wire");
  assert.ok(!text.includes("notes with"), "notes on wire");
  assert.ok(!text.includes("--raw-arg"), "args on wire");
  assert.ok(!text.includes(home), "home path on wire");
  assert.ok(text.includes("claude-kimi"));
  assert.ok(text.includes("ANTHROPIC_API_KEY"), "key NAME allowed");
});

test("valid token + corrupt registry -> 409, body names no file path", async () => {
  writeFileSync(path.join(home, "builders.json"), "{ not json");
  const GET = await freshGET();
  const res = await GET(authed());
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.corrupt, true);
  assert.ok(!JSON.stringify(body).includes(home), "error must not echo the file path");
});
