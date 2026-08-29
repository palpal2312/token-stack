import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  ALLOWED_TRANSITIONS,
  columnForState,
  OrchestrationEvent,
  OrchestrationStateStore,
  trackForLane,
} from "../orchestration-state";

function tempStore(t: { after: (fn: () => void) => void }): OrchestrationStateStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-state-"));
  const store = new OrchestrationStateStore(path.join(dir, "state.jsonl"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return store;
}

function ev(over: Partial<OrchestrationEvent>): OrchestrationEvent {
  return {
    lane: "community",
    task: "S09-C1-COMMUNITY-INTAKE",
    transition: "QUEUED",
    summary: "intake queue accepted",
    ...over,
  };
}

const C = { controller: true } as const;

test("valid required chain QUEUED->DISPATCHED->RUNNING->DONE is accepted", (t) => {
  const store = tempStore(t);
  store.append(ev({ transition: "QUEUED" }), C);
  store.append(ev({ transition: "DISPATCHED" }), C);
  store.append(ev({ transition: "RUNNING" }), C);
  store.append(
    ev({
      transition: "DONE",
      evidencePath: "plans/reports/sprint09/s09-i4-controlled-delivery-promotion-receipt.md",
      evidenceSha256: "eaca3f85577d97b3175eec3617e41a6342d1dc4e6b54066bdea836e9ac24331f",
      summary: "promotion receipt verified",
    }),
    C,
  );
  const lanes = store.deriveLanes();
  assert.equal(lanes.length, 1);
  assert.equal(lanes[0].currentState, "DONE");
  assert.equal(lanes[0].timeline.length, 4);
  assert.equal(lanes[0].evidence?.sha256, "eaca3f85577d97b3175eec3617e41a6342d1dc4e6b54066bdea836e9ac24331f");
});

test("WAITING_ON branch and resume are accepted", (t) => {
  const store = tempStore(t);
  for (const s of ["QUEUED", "DISPATCHED", "WAITING_ON"] as const) {
    store.append(ev({ transition: s, prerequisite: s === "WAITING_ON" ? "I5 promotion" : undefined }), C);
  }
  assert.equal(store.currentState("community"), "WAITING_ON");
  store.append(ev({ transition: "RUNNING", summary: "prerequisite cleared" }), C);
  store.append(ev({ transition: "DONE", summary: "lane finished" }), C);
  assert.equal(store.currentState("community"), "DONE");
});

test("WAITING_ON may also terminate in BLOCKED", (t) => {
  const store = tempStore(t);
  store.append(ev({ transition: "QUEUED" }), C);
  store.append(ev({ transition: "DISPATCHED" }), C);
  store.append(ev({ transition: "WAITING_ON", prerequisite: "contracts.ts decision" }), C);
  store.append(ev({ transition: "BLOCKED", summary: "prerequisite not cleared" }), C);
  assert.equal(store.currentState("community"), "BLOCKED");
});

test("illegal transitions are rejected", (t) => {
  const store = tempStore(t);
  assert.throws(() => store.append(ev({ transition: "RUNNING" }), C), /first event.*QUEUED/);
  store.append(ev({ transition: "QUEUED" }), C);
  assert.throws(() => store.append(ev({ transition: "RUNNING" }), C), /invalid transition QUEUED -> RUNNING/);
  store.append(ev({ transition: "DISPATCHED" }), C);
  assert.throws(() => store.append(ev({ transition: "QUEUED" }), C), /invalid transition DISPATCHED -> QUEUED/);
  store.append(ev({ transition: "RUNNING" }), C);
  store.append(ev({ transition: "DONE" }), C);
  assert.throws(() => store.append(ev({ transition: "RUNNING" }), C), /terminal/);
  assert.throws(() => store.append(ev({ transition: "UNKNOWN" as never }), C), /unknown transition/);
});

test("controller gate blocks non-controller writes", (t) => {
  const store = tempStore(t);
  assert.throws(() => store.append(ev({}), {}), /controller-only/);
  store.append(ev({}), C);
  assert.equal(store.currentState("community"), "QUEUED");
});

test("redaction rejects forbidden content in summaries", (t) => {
  const store = tempStore(t);
  store.append(ev({}), C);
  for (const bad of [
    "see prompt text for details",
    "contains a secret value",
    "uses a private key",
    "api key rotated",
    "raw conversation captured",
    "paste the diff here",
  ]) {
    assert.throws(
      () => store.append(ev({ transition: "DISPATCHED", summary: bad }), C),
      /forbidden marker/,
    );
  }
  assert.throws(
    () => store.append(ev({ transition: "DISPATCHED", summary: "x".repeat(201) }), C),
    /exceeds/,
  );
});

test("evidence path and hash must pair and hash must be sha256 hex", (t) => {
  const store = tempStore(t);
  store.append(ev({}), C);
  assert.throws(
    () => store.append(ev({ transition: "DISPATCHED", evidencePath: "a.md" }), C),
    /together/,
  );
  assert.throws(
    () =>
      store.append(
        ev({ transition: "DISPATCHED", evidencePath: "a.md", evidenceSha256: "zzz" }),
        C,
      ),
    /64-char hex/,
  );
  store.append(
    ev({
      transition: "DISPATCHED",
      evidencePath: "a.md",
      evidenceSha256: "0".repeat(64),
    }),
    C,
  );
  assert.equal(store.currentState("community"), "DISPATCHED");
});

test("journal is append-only and replay-reconstructed", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-replay-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "state.jsonl");
  const store = new OrchestrationStateStore(file);
  const base = ev({
    lane: "controlled-delivery",
    task: "S09-C2-CONTROLLED-DELIVERY",
    transition: "QUEUED",
  });
  store.append(base, C);
  store.append({ ...ev({ transition: "DISPATCHED" }), lane: "controlled-delivery" }, C);
  const bytes1 = fs.readFileSync(file, "utf8");
  const reopened = new OrchestrationStateStore(file);
  assert.deepEqual(reopened.readEvents().map((e) => e.transition), ["QUEUED", "DISPATCHED"]);
  assert.equal(reopened.currentState("controlled-delivery"), "DISPATCHED");
  reopened.append({ ...ev({ transition: "RUNNING" }), lane: "controlled-delivery" }, C);
  const bytes2 = fs.readFileSync(file, "utf8");
  assert.equal(bytes2.startsWith(bytes1), true, "journal only grows, never rewrites");
});

test("board track mapping follows Sprint 09 lanes A/B/C", () => {
  assert.equal(trackForLane("community-intake"), "A");
  assert.equal(trackForLane("community"), "A");
  assert.equal(trackForLane("snapshot-return"), "A");
  assert.equal(trackForLane("controlled-delivery"), "B");
  assert.equal(trackForLane("integration-baseline"), "C");
  assert.equal(trackForLane("dto-drift"), "C");
  assert.equal(trackForLane("orchestration-dashboard"), "C");
  assert.equal(trackForLane("contract"), "C");
  assert.equal(trackForLane("unknown-domain"), "C");
});

test("board column derives from journal state", () => {
  assert.equal(columnForState("QUEUED"), "todo");
  assert.equal(columnForState("DISPATCHED"), "in-progress");
  assert.equal(columnForState("RUNNING"), "in-progress");
  assert.equal(columnForState("WAITING_ON"), "in-progress");
  assert.equal(columnForState("DONE"), "done");
  assert.equal(columnForState("BLOCKED"), "done");
  assert.equal(columnForState("FAILED"), "done");
});

test("wildcard transition table has the required chain shapes", () => {
  assert.deepEqual(ALLOWED_TRANSITIONS.QUEUED, ["DISPATCHED"]);
  assert.deepEqual([...ALLOWED_TRANSITIONS.DISPATCHED].sort(), ["RUNNING", "WAITING_ON"]);
  assert.deepEqual([...ALLOWED_TRANSITIONS.WAITING_ON].sort(), [
    "BLOCKED",
    "DONE",
    "FAILED",
    "RUNNING",
  ]);
  assert.equal(ALLOWED_TRANSITIONS.DONE.length, 0);
  assert.equal(ALLOWED_TRANSITIONS.BLOCKED.length, 0);
  assert.equal(ALLOWED_TRANSITIONS.FAILED.length, 0);
});