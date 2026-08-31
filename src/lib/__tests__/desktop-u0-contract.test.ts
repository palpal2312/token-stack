import assert from "node:assert/strict";
import test from "node:test";
import { DESKTOP_U0_CONTRACT, getDesktopU0Contract } from "../desktop-u0-contract";

test("Phase 19a U0 exposes only evidence-backed presentation boundaries", () => {
  assert.equal(getDesktopU0Contract(), DESKTOP_U0_CONTRACT);
  assert.equal(DESKTOP_U0_CONTRACT.executionAuthority, "outside-nextjs");
  assert.equal(DESKTOP_U0_CONTRACT.desktopPackaging, "deferred");
  assert.equal(DESKTOP_U0_CONTRACT.configSchemaAuthority, "go-prerequisite-required");
  assert.equal(DESKTOP_U0_CONTRACT.initialShell.heavyFeatures, "load-on-request");
  assert.equal(DESKTOP_U0_CONTRACT.initialShell.workspaceRealtimeListeners, 1);
});

test("Phase 19a U0 contract cannot be mutated by a caller", () => {
  assert.throws(() => {
    (DESKTOP_U0_CONTRACT as { status: string }).status = "implemented";
  }, TypeError);
  assert.equal(DESKTOP_U0_CONTRACT.status, "baseline-recorded");
});
