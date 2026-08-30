import assert from "node:assert/strict";
import test from "node:test";

import {
  fixtureRuntimeSlots,
  LOADING_VIEW,
  ORCA_SLOT_DTO_VERSION,
  parseRuntimeSlots,
  toSlotView,
} from "../../src/lib/agentRuntime/orca-slot-client";
// Import proves the component module (and its lucide-react imports) loads
// under the tsx runner without breaking the type graph.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import OrcaSlotStatus from "../../src/components/OrcaSlotStatus";

test("parses every slot state into the matching view status", () => {
  const cases: Array<[string, string]> = [
    ["free", "available"],
    ["reserved", "available"],
    ["launching", "available"],
    ["running", "available"],
    ["reconciling", "drifted"],
    ["draining", "available"],
  ];
  for (const [state, want] of cases) {
    const dto = parseRuntimeSlots(fixtureRuntimeSlots({ state: state as never }));
    assert.ok(dto, `fixture for ${state} must parse`);
    const view = toSlotView(dto, "orca-lab-0");
    assert.equal(view.status, want, `state ${state}`);
    assert.equal(view.capacity, 1);
    assert.equal(view.inFlight, 0);
  }
});

test("lab disabled maps to disabled, hiding slot detail", () => {
  const dto = parseRuntimeSlots(fixtureRuntimeSlots({ builder_label: "Claude", attempt_ref: "a-1" }, false));
  assert.ok(dto);
  const view = toSlotView(dto, "orca-lab-0");
  assert.equal(view.status, "disabled");
  assert.equal(view.capacity, null);
  assert.equal(view.builderLabel, null, "disabled view must not show bound Builder");
});

test("running slot shows label, attempt reference and observation time only", () => {
  const dto = parseRuntimeSlots(fixtureRuntimeSlots({
    state: "running",
    in_flight: 1,
    builder_label: "Claude via Kimi",
    attempt_ref: "attempt-7",
    reason: "launching",
  }));
  const view = toSlotView(dto!, "orca-lab-0");
  assert.equal(view.builderLabel, "Claude via Kimi");
  assert.equal(view.attemptRef, "attempt-7");
  assert.equal(view.lastObservedAt, "2026-08-18T00:00:00.000Z");
  assert.equal(view.reason, "launching");
});

test("secret-bearing extra wire fields are dropped at the parse boundary", () => {
  const fixture = fixtureRuntimeSlots({ state: "running" }) as unknown as Record<string, unknown>;
  const slot = (fixture.slots as Array<Record<string, unknown>>)[0];
  slot.command = "claude --dangerous";
  slot.token = "sk-secret-value";
  slot.auth_path = "C:\\Users\\x\\.config\\claude";
  slot.env = { ANTHROPIC_API_KEY: "sk-secret-value" };
  const dto = parseRuntimeSlots(fixture);
  assert.ok(dto, "extra fields must be tolerated");
  const wire = JSON.stringify(dto);
  assert.ok(!wire.includes("sk-secret-value"), "secret leaked through parse");
  assert.ok(!wire.includes("--dangerous"), "raw command leaked through parse");
  assert.ok(!wire.includes(".config"), "config path leaked through parse");
  const view = toSlotView(dto, "orca-lab-0");
  assert.ok(!JSON.stringify(view).includes("sk-secret-value"));
});

test("malformed payloads fail closed to error view", () => {
  assert.equal(parseRuntimeSlots(null), null);
  assert.equal(parseRuntimeSlots({}), null);
  assert.equal(parseRuntimeSlots({ dto_version: ORCA_SLOT_DTO_VERSION + 1, lab_enabled: true, slots: [] }), null);
  assert.equal(parseRuntimeSlots(fixtureRuntimeSlots({ capacity: -1 })), null);
  assert.equal(parseRuntimeSlots(fixtureRuntimeSlots({ state: "bogus" as never })), null);
  assert.equal(parseRuntimeSlots(fixtureRuntimeSlots({ last_observed_at: "not-a-date" })), null);
  assert.equal(parseRuntimeSlots(fixtureRuntimeSlots({ reason: "x".repeat(500) })), null);
  const view = toSlotView(null, "orca-lab-0");
  assert.equal(view.status, "error");
});

test("loading view is the pre-data placeholder with no slot detail", () => {
  assert.equal(LOADING_VIEW.status, "loading");
  assert.equal(LOADING_VIEW.capacity, null);
  assert.equal(LOADING_VIEW.builderLabel, null);
  assert.equal(LOADING_VIEW.attemptRef, null);
});

test("unknown slot id maps to error, not a guess", () => {
  const dto = parseRuntimeSlots(fixtureRuntimeSlots());
  const view = toSlotView(dto!, "orca-lab-9");
  assert.equal(view.status, "error");
  assert.match(view.reason ?? "", /orca-lab-9/);
});
