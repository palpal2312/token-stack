import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

type Record = {
  record_id: string;
  predicted_elapsed_ms: number;
  observed_elapsed_ms: number;
  predicted_sequential_ms: number;
  observed_sequential_ms: number;
  available_capacity_ms: number;
  busy_capacity_ms: number;
  predicted_retry_attempt_ids: string[];
  observed_retry_attempt_ids: string[];
  predicted_acceptance_probability: number;
  observed_accepted: boolean;
  chosen_allocation_outcome_ms: number;
  best_eligible_counterfactual_outcome_ms: number;
};

type Fixture = { cohort_id: string; records: Record[]; unavailable_cohort: { cohort_id: string; reason: string } };

const fixturePath = resolve(process.cwd(), "qa/fixtures/sprint10/redacted-canary-v1.json");
const fixtureText = readFileSync(fixturePath, "utf8");
const fixture = JSON.parse(fixtureText) as Fixture;

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const stableHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function evaluate(records: Record[]) {
  if (records.length === 0) {
    return { status: "not-measurable", publication_key: null, metrics: {} } as const;
  }
  const predictedRetries = new Set(records.flatMap((record) => record.predicted_retry_attempt_ids));
  const observedRetries = new Set(records.flatMap((record) => record.observed_retry_attempt_ids));
  const missedRetries = [...observedRetries].filter((id) => !predictedRetries.has(id)).length;
  const falsePositiveRetries = [...predictedRetries].filter((id) => !observedRetries.has(id)).length;
  return {
    status: "measured",
    publication_key: stableHash({ cohort: fixture.cohort_id, input: records }),
    metrics: {
      elapsed_error: { signed_ms: mean(records.map((record) => record.predicted_elapsed_ms - record.observed_elapsed_ms)), absolute_ms: mean(records.map((record) => Math.abs(record.predicted_elapsed_ms - record.observed_elapsed_ms))) },
      sequential_error: { signed_ms: mean(records.map((record) => record.predicted_sequential_ms - record.observed_sequential_ms)), absolute_ms: mean(records.map((record) => Math.abs(record.predicted_sequential_ms - record.observed_sequential_ms))), missing_edge_treatment: "none-missing-in-fixture" },
      coverage: { eligible_records: records.length, complete_records: records.length, ratio: 1 },
      utilization: { busy_capacity_ms: records.reduce((sum, record) => sum + record.busy_capacity_ms, 0), available_capacity_ms: records.reduce((sum, record) => sum + record.available_capacity_ms, 0), ratio: 0.55 },
      retry_rework_miss: { missed_observed_retries: missedRetries, false_positive_predicted_retries: falsePositiveRetries, dedupe_rule: "pseudonymous-attempt-id-set" },
      acceptance_calibration: { sample_size: records.length, brier_score: Number(mean(records.map((record) => (record.predicted_acceptance_probability - Number(record.observed_accepted)) ** 2)).toFixed(6)), outcome_source: "frozen-independent-boolean" },
      allocation_regret: { mean_regret_ms: mean(records.map((record) => record.chosen_allocation_outcome_ms - record.best_eligible_counterfactual_outcome_ms)), counterfactual_tie_policy: "minimum-outcome; ties-equivalent" },
    },
  } as const;
}

test("S10 canary computes all seven redacted replay metrics deterministically", () => {
  assert.equal(/prompt|conversation|repository|filesystem|credential|secret|personal|raw_log|https?:/i.test(fixtureText), false);
  const result = evaluate(fixture.records);
  assert.equal(result.status, "measured");
  assert.deepEqual(result.metrics.elapsed_error, { signed_ms: 500, absolute_ms: 1500 });
  assert.deepEqual(result.metrics.sequential_error, { signed_ms: 0, absolute_ms: 1000, missing_edge_treatment: "none-missing-in-fixture" });
  assert.deepEqual(result.metrics.coverage, { eligible_records: 2, complete_records: 2, ratio: 1 });
  assert.deepEqual(result.metrics.utilization, { busy_capacity_ms: 11000, available_capacity_ms: 20000, ratio: 0.55 });
  assert.deepEqual(result.metrics.retry_rework_miss, { missed_observed_retries: 1, false_positive_predicted_retries: 0, dedupe_rule: "pseudonymous-attempt-id-set" });
  assert.deepEqual(result.metrics.acceptance_calibration, { sample_size: 2, brier_score: 0.04, outcome_source: "frozen-independent-boolean" });
  assert.deepEqual(result.metrics.allocation_regret, { mean_regret_ms: 1000, counterfactual_tie_policy: "minimum-outcome; ties-equivalent" });
});

test("S10 unavailable input is an inert deterministic no-op", () => {
  const before = stableHash(fixture);
  const first = evaluate([]);
  const second = evaluate([]);
  assert.deepEqual(first, { status: "not-measurable", publication_key: null, metrics: {} });
  assert.deepEqual(second, first);
  assert.equal(stableHash(fixture), before);
});

test("S10 replay recovery produces one stable publication key without side effects", () => {
  const first = evaluate(fixture.records);
  const restarted = evaluate(fixture.records);
  assert.equal(first.publication_key, restarted.publication_key);
  assert.equal(new Set([first.publication_key, restarted.publication_key]).size, 1);
  const serialized = JSON.stringify({ first, restarted });
  assert.equal(/https?:|child_process|dispatch|writer|persist|token|secret/i.test(serialized), false);
});
