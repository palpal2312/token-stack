import { createHash } from "node:crypto";

/**
 * Offline-only S10 replay evaluator.  Its input is an already redacted,
 * frozen snapshot; it has no filesystem, network, queue, or writer surface.
 */
export const S10_METRIC_NAMES = [
  "elapsed_error", "sequential_error", "coverage", "utilization",
  "retry_rework_miss", "acceptance_calibration", "allocation_regret",
] as const;

export type S10MetricName = (typeof S10_METRIC_NAMES)[number];
export type MetricState = "measured" | "not-measurable" | "insufficient-sample";

export interface S10ReplayRecord {
  record_id: string;
  predicted_elapsed_ms?: number;
  observed_elapsed_ms?: number;
  predicted_sequential_ms?: number;
  observed_sequential_ms?: number;
  available_capacity_ms?: number;
  busy_capacity_ms?: number;
  predicted_retry_attempt_ids?: string[];
  observed_retry_attempt_ids?: string[];
  predicted_acceptance_probability?: number;
  observed_accepted?: boolean;
  chosen_allocation_outcome_ms?: number;
  best_eligible_counterfactual_outcome_ms?: number;
  critical_path_id?: string;
  useful_lane_ids?: string[];
}

export interface S10FrozenReplayInput {
  schema_version: "1.0.0";
  fixture_id: string;
  cohort_id: string;
  provenance: {
    source_class: "frozen-redacted-replay";
    policy_revision: string;
    clock: "normalized-utc-ms";
    content_scope: "pseudonymous-metrics-only";
  };
  records: S10ReplayRecord[];
}

export interface S10MetricResult {
  state: MetricState;
  value: Record<string, number | string> | null;
}

export interface S10ReplayResult {
  status: "measured" | "not-measurable";
  inputHash: string | null;
  publicationKey: string | null;
  metrics: Record<S10MetricName, S10MetricResult>;
  confidence: "high" | "low";
  outOfDistribution: boolean;
  advisory: {
    criticalPathIds: string[];
    usefulLaneIds: string[];
    recommendation: "no-op" | "review-critical-path" | "consider-useful-lanes";
  };
}

const FORBIDDEN_KEYS = new Set([
  "prompt", "conversation", "repository", "filesystem", "credential", "secret", "token", "rawlog", "path", "url",
]);
const MIN_CONFIDENT_COHORT = 30;
const hash = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function validInput(input: unknown): input is S10FrozenReplayInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const walk = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.every(walk);
    if (!value || typeof value !== "object") return true;
    return Object.entries(value as Record<string, unknown>).every(([key, item]) => !FORBIDDEN_KEYS.has(key.replace(/[_-]/g, "").toLowerCase()) && walk(item));
  };
  const candidate = input as Partial<S10FrozenReplayInput>;
  return walk(input)
    && candidate.schema_version === "1.0.0"
    && typeof candidate.fixture_id === "string"
    && typeof candidate.cohort_id === "string"
    && candidate.provenance?.source_class === "frozen-redacted-replay"
    && candidate.provenance?.clock === "normalized-utc-ms"
    && candidate.provenance?.content_scope === "pseudonymous-metrics-only"
    && Array.isArray(candidate.records);
}

function mean(values: number[]): number { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function measured(value: S10MetricResult["value"]): S10MetricResult { return { state: "measured", value }; }
function unavailable(state: MetricState = "not-measurable"): S10MetricResult { return { state, value: null }; }
function pairs(records: S10ReplayRecord[], left: keyof S10ReplayRecord, right: keyof S10ReplayRecord): Array<[number, number]> {
  return records.flatMap((record) => typeof record[left] === "number" && typeof record[right] === "number"
    ? [[record[left] as number, record[right] as number]] : []);
}

function emptyMetrics(): Record<S10MetricName, S10MetricResult> {
  return Object.fromEntries(S10_METRIC_NAMES.map((name) => [name, unavailable()])) as Record<S10MetricName, S10MetricResult>;
}

/** Computes measurements only; no score or recommendation can authorize execution. */
export function evaluateS10FrozenReplay(input: unknown): S10ReplayResult {
  if (!validInput(input) || input.records.length === 0) {
    return { status: "not-measurable", inputHash: null, publicationKey: null, metrics: emptyMetrics(), confidence: "low", outOfDistribution: true,
      advisory: { criticalPathIds: [], usefulLaneIds: [], recommendation: "no-op" } };
  }

  const elapsed = pairs(input.records, "predicted_elapsed_ms", "observed_elapsed_ms");
  const sequential = pairs(input.records, "predicted_sequential_ms", "observed_sequential_ms");
  const capacity = pairs(input.records, "busy_capacity_ms", "available_capacity_ms").filter(([, available]) => available > 0);
  const acceptance = input.records.filter((r) => typeof r.predicted_acceptance_probability === "number" && typeof r.observed_accepted === "boolean");
  const regret = pairs(input.records, "chosen_allocation_outcome_ms", "best_eligible_counterfactual_outcome_ms");
  const predictedRetries = new Set(input.records.flatMap((r) => r.predicted_retry_attempt_ids ?? []));
  const observedRetries = new Set(input.records.flatMap((r) => r.observed_retry_attempt_ids ?? []));
  const metrics = emptyMetrics();
  if (elapsed.length) metrics.elapsed_error = measured({ signed_ms: mean(elapsed.map(([p, o]) => p - o)), absolute_ms: mean(elapsed.map(([p, o]) => Math.abs(p - o))) });
  if (sequential.length) metrics.sequential_error = measured({ signed_ms: mean(sequential.map(([p, o]) => p - o)), absolute_ms: mean(sequential.map(([p, o]) => Math.abs(p - o))), missing_edge_treatment: "not-imputed" });
  const complete = input.records.filter((r) => r.record_id.length > 0
    && typeof r.predicted_elapsed_ms === "number" && typeof r.observed_elapsed_ms === "number"
    && typeof r.predicted_sequential_ms === "number" && typeof r.observed_sequential_ms === "number"
    && typeof r.available_capacity_ms === "number" && typeof r.busy_capacity_ms === "number"
    && Array.isArray(r.predicted_retry_attempt_ids) && Array.isArray(r.observed_retry_attempt_ids)
    && typeof r.predicted_acceptance_probability === "number" && typeof r.observed_accepted === "boolean"
    && typeof r.chosen_allocation_outcome_ms === "number" && typeof r.best_eligible_counterfactual_outcome_ms === "number").length;
  metrics.coverage = measured({ eligible_records: input.records.length, complete_records: complete, ratio: complete / input.records.length });
  if (capacity.length) metrics.utilization = measured({ busy_capacity_ms: capacity.reduce((sum, [busy]) => sum + busy, 0), available_capacity_ms: capacity.reduce((sum, [, available]) => sum + available, 0), ratio: capacity.reduce((sum, [busy]) => sum + busy, 0) / capacity.reduce((sum, [, available]) => sum + available, 0) });
  if (predictedRetries.size || observedRetries.size) metrics.retry_rework_miss = measured({ missed_observed_retries: [...observedRetries].filter((id) => !predictedRetries.has(id)).length, false_positive_predicted_retries: [...predictedRetries].filter((id) => !observedRetries.has(id)).length, dedupe_rule: "pseudonymous-attempt-id-set" });
  if (acceptance.length >= 2) metrics.acceptance_calibration = measured({ sample_size: acceptance.length, brier_score: Number(mean(acceptance.map((r) => (r.predicted_acceptance_probability! - Number(r.observed_accepted)) ** 2)).toFixed(6)), outcome_source: "frozen-independent-boolean" });
  else if (acceptance.length) metrics.acceptance_calibration = unavailable("insufficient-sample");
  if (regret.length) metrics.allocation_regret = measured({ mean_regret_ms: mean(regret.map(([chosen, best]) => chosen - best)), counterfactual_tie_policy: "minimum-outcome; ties-equivalent" });
  const inputHash = hash(input);
  const criticalPathIds = [...new Set(input.records.map((r) => r.critical_path_id).filter((id): id is string => !!id))].sort();
  const usefulLaneIds = [...new Set(input.records.flatMap((r) => r.useful_lane_ids ?? []))].sort();
  const confidence = input.records.length >= MIN_CONFIDENT_COHORT ? "high" : "low";
  return { status: "measured", inputHash, publicationKey: hash({ cohort: input.cohort_id, inputHash, metrics }), metrics,
    confidence, outOfDistribution: confidence === "low",
    advisory: { criticalPathIds, usefulLaneIds, recommendation: criticalPathIds.length ? "review-critical-path" : usefulLaneIds.length ? "consider-useful-lanes" : "no-op" } };
}
