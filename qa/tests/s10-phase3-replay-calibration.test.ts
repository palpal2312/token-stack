import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { calibrateS10FrozenReplay } from "../../src/lib/llmops/s10-replay-calibration";

const fixture = JSON.parse(readFileSync(resolve(process.cwd(), "qa/fixtures/sprint10/redacted-canary-v1.json"), "utf8"));

test("calibration replays baseline and candidate over the same local frozen cohort", () => {
  const result = calibrateS10FrozenReplay(fixture);
  assert.equal(result.status, "measured");
  assert.equal(result.source, "local-history-first");
  assert.deepEqual(result.baseline.metrics, result.candidate.metrics);
  assert.equal(result.intervals.elapsed_error?.level, 0.9);
  assert.equal(result.selection.addedCapacity, "not-recommended");
  assert.equal(result.confidence, "low");
  assert.equal(result.outOfDistribution, true);
});

test("sparse, private, and unavailable replay fails closed without a publication key", () => {
  for (const input of [[], { ...fixture, prompt: "private" }, { ...fixture, records: [] }]) {
    const result = calibrateS10FrozenReplay(input);
    assert.equal(result.status, "not-measurable");
    assert.equal(result.source, "no-op");
    assert.equal(result.publicationKey, null);
    assert.equal(result.selection.workflow, "no-op");
  }
});

test("critical path and useful lanes remain advisory and deterministic", () => {
  const enriched = { ...fixture, records: fixture.records.map((record: object) => ({ ...record, critical_path_id: "cp-redacted", useful_lane_ids: ["lane-a"] })) };
  const first = calibrateS10FrozenReplay(enriched);
  const second = calibrateS10FrozenReplay(JSON.parse(JSON.stringify(enriched)));
  assert.deepEqual(first.selection, { criticalPathIds: ["cp-redacted"], usefulLaneIds: ["lane-a"], workflow: "review-critical-path", addedCapacity: "advisory-review-only" });
  assert.equal(first.publicationKey, second.publicationKey);
});
