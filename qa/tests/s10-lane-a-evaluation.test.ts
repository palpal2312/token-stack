import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { evaluateS10FrozenReplay } from "../../src/lib/llmops/s10-replay-evaluation";

const fixture = JSON.parse(readFileSync(resolve(process.cwd(), "qa/fixtures/sprint10/redacted-canary-v1.json"), "utf8"));

test("S10 Lane A measures the seven frozen redacted metrics deterministically", () => {
  const first = evaluateS10FrozenReplay(fixture);
  const second = evaluateS10FrozenReplay(JSON.parse(JSON.stringify(fixture)));
  assert.equal(first.status, "measured");
  assert.equal(first.publicationKey, second.publicationKey);
  assert.deepEqual(first.metrics.elapsed_error.value, { signed_ms: 500, absolute_ms: 1500 });
  assert.deepEqual(first.metrics.sequential_error.value, { signed_ms: 0, absolute_ms: 1000, missing_edge_treatment: "not-imputed" });
  assert.deepEqual(first.metrics.utilization.value, { busy_capacity_ms: 11000, available_capacity_ms: 20000, ratio: 0.55 });
  assert.equal(first.metrics.retry_rework_miss.value?.missed_observed_retries, 1);
  assert.equal(first.metrics.acceptance_calibration.value?.brier_score, 0.04);
  assert.equal(first.metrics.allocation_regret.value?.mean_regret_ms, 1000);
  assert.equal(first.confidence, "low");
  assert.equal(first.outOfDistribution, true);
});

test("S10 Lane A local history is required and private or unavailable inputs fail closed", () => {
  const privateInput = { ...fixture, prompt: "not accepted" };
  for (const input of [[], privateInput]) {
    const result = evaluateS10FrozenReplay(input);
    assert.equal(result.status, "not-measurable");
    assert.equal(result.publicationKey, null);
    assert.equal(result.advisory.recommendation, "no-op");
  }
});

test("S10 Lane A makes only advisory critical-path and useful-lane recommendations", () => {
  const result = evaluateS10FrozenReplay({ ...fixture, records: fixture.records.map((record: object, index: number) => ({ ...record, critical_path_id: "cp-redacted", useful_lane_ids: index ? ["lane-b"] : ["lane-a", "lane-b"] })) });
  assert.deepEqual(result.advisory.criticalPathIds, ["cp-redacted"]);
  assert.deepEqual(result.advisory.usefulLaneIds, ["lane-a", "lane-b"]);
  assert.equal(result.advisory.recommendation, "review-critical-path");
});
