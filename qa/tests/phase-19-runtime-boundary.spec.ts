import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const importFresh = (modulePath: string) => import(`${modulePath}?phase19-${crypto.randomUUID()}`);

test("Phase 19 runtime boundary flags, cache metadata, recovery, and protection", async () => {
  const originalEnv = {
    AGENTIC_OS_HOME: process.env.AGENTIC_OS_HOME,
    SEN_DAEMON_URL: process.env.SEN_DAEMON_URL,
    SEN_GO_SANDBOX_WORKERS: process.env.SEN_GO_SANDBOX_WORKERS,
    SEN_GO_HERDR_SNAPSHOT_CACHE: process.env.SEN_GO_HERDR_SNAPSHOT_CACHE,
    SEN_GO_CODESPACE_SUMMARY: process.env.SEN_GO_CODESPACE_SUMMARY,
    SEN_GO_EXECUTION_MODE: process.env.SEN_GO_EXECUTION_MODE,
    SEN_WORKSPACE_ID: process.env.SEN_WORKSPACE_ID,
  };
  const home = await mkdtemp(path.join(os.tmpdir(), "agent-os-phase19-qa-"));
  process.env.AGENTIC_OS_HOME = home;
  process.env.SEN_DAEMON_URL = "http://127.0.0.1:3738";

  try {
    const { getApiToken } = await import("../../src/lib/apiToken");
    const token = getApiToken();
    const localRequest = (url: string, init: RequestInit = {}) => new Request(`http://127.0.0.1${url}`, {
      ...init,
      headers: {
        "x-agentic-os-token": token,
        ...(init.headers ?? {}),
      },
    });
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
    const originalFetch = globalThis.fetch;

    try {
      // The worker health route is fail-closed and does not touch the daemon when disabled.
      process.env.SEN_GO_SANDBOX_WORKERS = "0";
      const workersOff = await importFresh("../../src/app/api/herdr/workers/route.ts") as typeof import("../../src/app/api/herdr/workers/route");
      let fetchCalls = 0;
      globalThis.fetch = async () => {
        fetchCalls += 1;
        return json({ workers: [] });
      };
      const disabled = await workersOff.GET(localRequest("/api/herdr/workers"));
      assert.equal(disabled.status, 200);
      assert.deepEqual(await disabled.json(), { available: false, workers: [] });
      assert.equal(fetchCalls, 0, "disabled worker health must not probe the daemon");

      const unauthorized = await workersOff.GET(new Request("http://127.0.0.1/api/herdr/workers"));
      assert.equal(unauthorized.status, 401, "worker route must require the local API token");
      const foreign = await workersOff.GET(localRequest("/api/herdr/workers", {
        headers: { origin: "https://attacker.invalid" },
      }));
      assert.equal(foreign.status, 403, "worker route must reject foreign origins");

      // Production semantics: the flag resolves at request time (same as the
      // snapshot route), so one loaded module observes an env flip without
      // cache-busting. Module-load capture (the Session-187 regression) fails
      // this assertion under any shared loader.
      process.env.SEN_GO_SANDBOX_WORKERS = "1";
      let flipCalls = 0;
      globalThis.fetch = async () => {
        flipCalls += 1;
        return json({ workers: [] });
      };
      const flippedOn = await workersOff.GET(localRequest("/api/herdr/workers"));
      assert.equal(flippedOn.status, 200);
      assert.deepEqual(await flippedOn.json(), { available: true, workers: [] });
      assert.equal(flipCalls, 1, "same-instance flip must probe the daemon exactly once");

      // Enabled health reads a deterministic daemon projection and exposes health metadata.
      process.env.SEN_GO_SANDBOX_WORKERS = "1";
      const workersOn = await importFresh("../../src/app/api/herdr/workers/route.ts") as typeof import("../../src/app/api/herdr/workers/route");
      const worker = {
        worker_id: "worker-qa",
        profile: {
          provider_id: "agentenv",
          tier: "production-linux-kvm",
          is_sandbox: true,
          execution_modes: ["agentenv"],
          capabilities: ["kvm", "authenticated-ingress"],
          status: "degraded",
          reason: "missing /dev/kvm",
          evidence_ref: "evidence://worker-qa",
        },
        health: "unhealthy",
        effective_health: "unhealthy",
        active_sandboxes: 0,
        last_seen_at: "2026-08-13T00:00:00Z",
        capability_checks: [{ name: "kvm", status: "failed", detail: "missing /dev/kvm", evidence_ref: "evidence://worker-qa" }],
      };
      globalThis.fetch = async () => json({ workers: [worker] });
      const enabled = await workersOn.GET(localRequest("/api/herdr/workers"));
      assert.equal(enabled.status, 200);
      assert.deepEqual(await enabled.json(), { available: true, workers: [worker] });

      globalThis.fetch = async () => { throw new Error("daemon unavailable"); };
      const unavailable = await workersOn.GET(localRequest("/api/herdr/workers"));
      assert.equal(unavailable.status, 503);
      assert.deepEqual(await unavailable.json(), {
        available: false,
        workers: [],
        error: "Go sandbox worker connection failed: daemon unavailable",
      });

      // A daemon snapshot with Herdr down still carries worker health metadata.
      process.env.SEN_GO_HERDR_SNAPSHOT_CACHE = "1";
      process.env.SEN_GO_CODESPACE_SUMMARY = "0";
      const snapshotRequests: string[] = [];
      globalThis.fetch = async (input) => {
        const url = String(input);
        snapshotRequests.push(url);
        if (url.endsWith("/api/v1/herdr/snapshot")) {
          return json({
            snapshot: null,
            status: { installed: true, bin: "herdr", version: "0.1.0", running: false, error: "Herdr server is not answering" },
            cache: {
              generated_at: "2026-08-13T00:00:00Z",
              ttl_ms: 5000,
              age_ms: 100,
              stale: false,
              source_revision: 7,
              payload_hash: "hash-qa",
              last_refresh_error: null,
            },
          });
        }
        if (url.endsWith("/api/v1/runtime/attempts")) return json({ projection_version: "1", attempts: [] });
        if (url.endsWith("/api/v1/sandbox/workers")) return json({ workers: [worker] });
        throw new Error(`unexpected daemon request ${url}`);
      };
      const snapshotRoute = await importFresh("../../src/app/api/herdr/snapshot/route.ts") as typeof import("../../src/app/api/herdr/snapshot/route");
      const snapshotResponse = await snapshotRoute.GET();
      assert.equal(snapshotResponse.status, 200);
      const snapshotBody = await snapshotResponse.json();
      assert.equal(snapshotBody.snapshot, null);
      assert.equal(snapshotBody.status.running, false);
      assert.equal(snapshotBody.status.error, "Herdr server is not answering");
      assert.deepEqual(snapshotBody.sandboxWorkers, [worker]);
      assert.equal(snapshotBody.sandboxWorkersError, null);
      assert.equal(snapshotRequests.filter((url) => url.endsWith("/api/v1/herdr/snapshot")).length, 1);
      assert.equal(snapshotRequests.some((url) => url.includes("herdr --version")), false);

      // Production semantics: execution mode and workspace resolve at request
      // time (same class as workers/snapshot). Module-load capture of
      // SEN_GO_EXECUTION_MODE / SEN_WORKSPACE_ID fails these assertions on a
      // shared loader without cache-busting or re-import.
      process.env.SEN_GO_EXECUTION_MODE = "0";
      delete process.env.SEN_WORKSPACE_ID;
      const preferenceSameInstance = await importFresh("../../src/app/api/sen/execution-preference/route.ts") as typeof import("../../src/app/api/sen/execution-preference/route");
      const isDaemonPreference = (url: string) =>
        url.includes("/api/v1/workspace/") && url.endsWith("/execution-preference");
      const daemonWorkspace = (url: string) => {
        const match = url.match(/\/api\/v1\/workspace\/([^/]+)\/execution-preference$/);
        return match?.[1] ?? "";
      };
      const preferenceFixture = (workspaceId: string, mode: "host" | "agentenv" = "host") => ({
        workspace_id: workspaceId,
        requested_mode: mode,
        effective_mode: mode,
        resolution_reason: "eligible worker available",
        updated_at: "2026-08-16T00:00:00Z",
      });

      let offPreferenceCalls = 0;
      globalThis.fetch = async (input) => {
        offPreferenceCalls += 1;
        throw new Error(`unexpected fetch while execution mode is OFF: ${String(input)}`);
      };
      const modeOff = await preferenceSameInstance.GET(localRequest("/api/sen/execution-preference"));
      assert.equal(modeOff.status, 200);
      assert.deepEqual(await modeOff.json(), { available: false, preference: null });
      assert.equal(modeOff.headers.get("cache-control"), "no-store");
      assert.equal(offPreferenceCalls, 0, "default/OFF execution mode must not probe the daemon");

      const unauthorizedPreference = await preferenceSameInstance.GET(new Request("http://127.0.0.1/api/sen/execution-preference"));
      assert.equal(unauthorizedPreference.status, 401, "preference GET must require the local API token");
      const foreignPreference = await preferenceSameInstance.GET(localRequest("/api/sen/execution-preference", {
        headers: { origin: "https://attacker.invalid" },
      }));
      assert.equal(foreignPreference.status, 403, "preference GET must reject foreign origins");
      const missingContentType = await preferenceSameInstance.PUT(localRequest("/api/sen/execution-preference", {
        method: "PUT",
        body: JSON.stringify({ mode: "host" }),
      }));
      assert.equal(missingContentType.status, 415, "preference PUT must require application/json");
      const invalidJson = await preferenceSameInstance.PUT(localRequest("/api/sen/execution-preference", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: "not-json",
      }));
      assert.equal(invalidJson.status, 400);
      const invalidMode = await preferenceSameInstance.PUT(localRequest("/api/sen/execution-preference", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "invalid" }),
      }));
      assert.equal(invalidMode.status, 400);

      process.env.SEN_GO_EXECUTION_MODE = "1";
      process.env.SEN_WORKSPACE_ID = "workspace-A";
      const preferenceCalls: { url: string; method: string; body: string | undefined }[] = [];
      globalThis.fetch = async (input, init) => {
        const url = String(input);
        preferenceCalls.push({
          url,
          method: String(init?.method ?? "GET"),
          body: init?.body === undefined ? undefined : String(init.body),
        });
        if (!isDaemonPreference(url)) throw new Error(`unexpected non-daemon preference request ${url}`);
        return json(preferenceFixture(decodeURIComponent(daemonWorkspace(url))));
      };
      const flippedModeOn = await preferenceSameInstance.GET(localRequest("/api/sen/execution-preference"));
      assert.equal(flippedModeOn.status, 200);
      assert.equal(flippedModeOn.headers.get("cache-control"), "no-store");
      const flippedModeOnBody = await flippedModeOn.json();
      assert.equal(flippedModeOnBody.available, true);
      assert.equal(flippedModeOnBody.preference.workspaceId, "workspace-A");
      assert.equal(flippedModeOnBody.preference.effectiveMode, "host");
      assert.equal(preferenceCalls.length, 1, "same-instance OFF -> ON GET must probe the daemon exactly once");
      assert.equal(daemonWorkspace(preferenceCalls[0].url), "workspace-A");
      assert.equal(preferenceCalls[0].method, "GET");

      process.env.SEN_WORKSPACE_ID = "workspace-B";
      const flippedWorkspace = await preferenceSameInstance.GET(localRequest("/api/sen/execution-preference"));
      assert.equal(flippedWorkspace.status, 200);
      assert.equal((await flippedWorkspace.json()).preference.workspaceId, "workspace-B");
      assert.equal(preferenceCalls.length, 2, "workspace-A -> workspace-B must cause a second daemon call");
      assert.equal(daemonWorkspace(preferenceCalls[1].url), "workspace-B");

      const flippedWorkspacePut = await preferenceSameInstance.PUT(localRequest("/api/sen/execution-preference", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "host" }),
      }));
      assert.equal(flippedWorkspacePut.status, 200);
      assert.equal((await flippedWorkspacePut.json()).preference.workspaceId, "workspace-B");
      assert.equal(preferenceCalls.length, 3, "PUT on workspace-B must probe the daemon once more");
      assert.equal(daemonWorkspace(preferenceCalls[2].url), "workspace-B");
      assert.equal(preferenceCalls[2].method, "PUT");
      assert.equal(JSON.parse(String(preferenceCalls[2].body)).requested_mode, "host");

      globalThis.fetch = async () => { throw new Error("daemon unavailable"); };
      const offlinePreference = await preferenceSameInstance.GET(localRequest("/api/sen/execution-preference"));
      assert.equal(offlinePreference.status, 200);
      assert.deepEqual(await offlinePreference.json(), { available: false, preference: null });
      const offlinePreferencePut = await preferenceSameInstance.PUT(localRequest("/api/sen/execution-preference", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "host" }),
      }));
      assert.equal(offlinePreferencePut.status, 503);
      assert.deepEqual(await offlinePreferencePut.json(), { error: "daemon execution preference update failed" });

      // A daemon 409 is visible to the caller, then a recovered preference is returned.
      process.env.SEN_GO_EXECUTION_MODE = "1";
      process.env.SEN_WORKSPACE_ID = "workspace-qa";
      const preferenceRoute = await importFresh("../../src/app/api/sen/execution-preference/route.ts") as typeof import("../../src/app/api/sen/execution-preference/route");
      let preferenceBlocked = true;
      let requestedMode = "agentenv";
      globalThis.fetch = async (_input, init) => {
        const body = init?.body ? JSON.parse(String(init.body)) as { requested_mode?: string } : null;
        if (body?.requested_mode) requestedMode = body.requested_mode;
        if (preferenceBlocked) {
          return json({ requested_mode: requestedMode, reason_codes: ["no_eligible_worker"], detail: "No eligible AgentENV worker is healthy." }, 409);
        }
        return json({
          workspace_id: "workspace-qa",
          requested_mode: requestedMode,
          effective_mode: requestedMode,
          resolution_reason: "eligible worker available",
          updated_at: "2026-08-13T00:01:00Z",
        });
      };
      const blockedGet = await preferenceRoute.GET(localRequest("/api/sen/execution-preference"));
      assert.equal(blockedGet.status, 409);
      assert.deepEqual((await blockedGet.json()).reasonCodes, ["no_eligible_worker"]);
      const blockedPut = await preferenceRoute.PUT(localRequest("/api/sen/execution-preference", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "agentenv" }),
      }));
      assert.equal(blockedPut.status, 409);
      assert.equal((await blockedPut.json()).requestedMode, "agentenv");

      preferenceBlocked = false;
      const recoveredGet = await preferenceRoute.GET(localRequest("/api/sen/execution-preference"));
      assert.equal(recoveredGet.status, 200);
      assert.equal((await recoveredGet.json()).preference.effectiveMode, "agentenv");
      const recoveredPut = await preferenceRoute.PUT(localRequest("/api/sen/execution-preference", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "agentenv" }),
      }));
      assert.equal(recoveredPut.status, 200);
      assert.equal((await recoveredPut.json()).preference.workspaceId, "workspace-qa");
    } finally {
      globalThis.fetch = originalFetch;
    }
  } finally {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(home, { recursive: true, force: true });
  }
});
