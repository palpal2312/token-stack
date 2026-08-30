import { createHash } from "node:crypto";

import {
  evaluateS10FrozenReplay,
  type S10FrozenReplayInput,
  type S10ReplayResult,
} from "./s10-replay-evaluation";

export interface S10CalibrationPolicy {
  policy_id: string;
  baseline_revision: string;
  candidate_revision: string;
  interval_level: number;
  minimum_confident_records: number;
}

export interface S10CalibrationResult {
  status: "measured" | "not-measurable";
  source: "local-history-first" | "no-op";
  baseline: S10ReplayResult;
  candidate: S10ReplayResult;
  assumptions: string[];
  intervals: Record<string, { level: number; lower: number; upper: number } | null>;
  selection: {
    criticalPathIds: string[];
    usefulLaneIds: string[];
    workflow: "review-critical-path" | "consider-useful-lanes" | "no-op";
    addedCapacity: "not-recommended" | "advisory-review-only";
  };
  confidence: "high" | "low";
  outOfDistribution: boolean;
  publicationKey: string | null;
}

const DEFAULT_POLICY: S10CalibrationPolicy = {
  policy_id: "s10-calibration-v1",
  baseline_revision: "baseline-frozen-v1",
  candidate_revision: "candidate-frozen-v1",
  interval_level: 0.9,
  minimum_confident_records: 30,
};

const stableHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value, Object.keys(value as object).sort())).digest("hex");

function interval(values: number[], level: number): { level: number; lower: number; upper: number } | null {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  const margin = 1.645 * Math.sqrt(variance / values.length);
  return { level, lower: Number((mean - margin).toFixed(3)), upper: Number((mean + margin).toFixed(3)) };
}

function metricIntervals(input: S10FrozenReplayInput, level: number): Record<string, { level: number; lower: number; upper: number } | null> {
  const errors = (left: keyof S10FrozenReplayInput["records"][number], right: keyof S10FrozenReplayInput["records"][number]) => input.records.flatMap((record) => typeof record[left] === "number" && typeof record[right] === "number" ? [(record[left] as number) - (record[right] as number)] : []);
  return {
    elapsed_error: interval(errors("predicted_elapsed_ms", "observed_elapsed_ms"), level),
    sequential_error: interval(errors("predicted_sequential_ms", "observed_sequential_ms"), level),
    allocation_regret: interval(errors("chosen_allocation_outcome_ms", "best_eligible_counterfactual_outcome_ms"), level),
  };
}

/** Pure, local-history-first calibration wrapper. It cannot authorize execution or publish records. */
export function calibrateS10FrozenReplay(input: unknown, policy: Partial<S10CalibrationPolicy> = {}): S10CalibrationResult {
  const selected = { ...DEFAULT_POLICY, ...policy };
  const baseline = evaluateS10FrozenReplay(input);
  const candidate = evaluateS10FrozenReplay(input);
  const assumptions = [
    "Only frozen redacted local history is eligible; community priors and private queries are not consulted.",
    "Missing fields are excluded per metric denominator and never imputed.",
    `Intervals use a deterministic normal approximation at ${(selected.interval_level * 100).toFixed(0)}% when at least two observations exist.`,
    "Candidate and baseline use identical frozen inputs and constraints; observed counterfactual is the minimum eligible outcome.",
  ];
  if (baseline.status !== "measured" || candidate.status !== "measured") {
    return { status: "not-measurable", source: "no-op", baseline, candidate, assumptions, intervals: {}, selection: { criticalPathIds: [], usefulLaneIds: [], workflow: "no-op", addedCapacity: "not-recommended" }, confidence: "low", outOfDistribution: true, publicationKey: null };
  }
  const selection = {
    criticalPathIds: candidate.advisory.criticalPathIds,
    usefulLaneIds: candidate.advisory.usefulLaneIds,
    workflow: candidate.advisory.recommendation,
    addedCapacity: candidate.advisory.criticalPathIds.length || candidate.advisory.usefulLaneIds.length ? "advisory-review-only" as const : "not-recommended" as const,
  };
  const confidence = input && typeof input === "object" && "records" in input && Array.isArray(input.records) && input.records.length >= selected.minimum_confident_records ? "high" : "low";
  const outOfDistribution = confidence === "low";
  const publicationKey = stableHash({ policy: selected, baseline: baseline.publicationKey, candidate: candidate.publicationKey, intervals: metricIntervals(input as S10FrozenReplayInput, selected.interval_level) });
  return { status: "measured", source: "local-history-first", baseline, candidate, assumptions, intervals: metricIntervals(input as S10FrozenReplayInput, selected.interval_level), selection, confidence, outOfDistribution, publicationKey };
}
