export const FORECAST_VERSION = "1.0.0";

export interface EstimateProposal {
  sequentialWorkHours: number;
  criticalPathHours: number;
  usefulLaneRange: { min: number; max: number };
  reviewRetryAllowanceHours: number;
  resourceAssumptions: { workerClass: string; maxConcurrentWorkers: number };
  hourlyCostRange: { min: number; max: number };
  sampleSize: number;
  uncertainty: number;
  cohortSupported: boolean;
}

export interface ForecastResult {
  forecastVersion: string;
  estimatorRevision: string;
  policyRevision: string;
  sequentialWork: { hours: number };
  criticalPath: { hours: number };
  usefulLaneRange: { min: number; max: number };
  elapsedTimeInterval: { minHours: number; maxHours: number };
  reviewRetryAllowance: { hours: number };
  resourceAssumptions: { workerClass: string; maxConcurrentWorkers: number };
  costRange: { min: number; max: number; currency: "USD" };
  confidence: "high" | "medium" | "low";
  distributionStatus: "in-distribution" | "out-of-distribution";
  sampleSize: number;
  uncertainty: number;
  disclaimer: string;
}

export function buildForecast(input: EstimateProposal): ForecastResult {
  const numbers = [input.sequentialWorkHours, input.criticalPathHours, input.reviewRetryAllowanceHours, input.hourlyCostRange.min, input.hourlyCostRange.max];
  if (numbers.some((n) => !Number.isFinite(n) || n < 0)) throw new Error("forecast values must be finite and non-negative");
  if (input.criticalPathHours > input.sequentialWorkHours) throw new Error("critical path cannot exceed sequential work");
  if (input.usefulLaneRange.min < 1 || input.usefulLaneRange.max < input.usefulLaneRange.min) throw new Error("invalid useful lane range");
  if (input.resourceAssumptions.maxConcurrentWorkers < input.usefulLaneRange.min) throw new Error("resources cannot support useful lane minimum");

  const outOfDistribution = !input.cohortSupported || input.sampleSize < 10 || input.uncertainty >= 0.5;
  const confidence = outOfDistribution ? "low" : input.sampleSize >= 50 && input.uncertainty <= 0.2 ? "high" : "medium";
  const optimisticParallel = input.sequentialWorkHours / input.usefulLaneRange.max;
  const lower = Math.max(input.criticalPathHours, optimisticParallel) + input.reviewRetryAllowanceHours;
  const width = Math.max(0.15, input.uncertainty) * lower;
  const minHours = Math.max(input.criticalPathHours + input.reviewRetryAllowanceHours, lower - width / 2);
  const maxHours = lower + width;
  const costHours = input.sequentialWorkHours + input.reviewRetryAllowanceHours;

  return {
    forecastVersion: FORECAST_VERSION,
    estimatorRevision: "s08a-estimator-1",
    policyRevision: "s08a-policy-1",
    sequentialWork: { hours: input.sequentialWorkHours },
    criticalPath: { hours: input.criticalPathHours },
    usefulLaneRange: input.usefulLaneRange,
    elapsedTimeInterval: { minHours: round(minHours), maxHours: round(maxHours) },
    reviewRetryAllowance: { hours: input.reviewRetryAllowanceHours },
    resourceAssumptions: input.resourceAssumptions,
    costRange: { min: round(costHours * input.hourlyCostRange.min), max: round(costHours * input.hourlyCostRange.max), currency: "USD" },
    confidence,
    distributionStatus: outOfDistribution ? "out-of-distribution" : "in-distribution",
    sampleSize: input.sampleSize,
    uncertainty: input.uncertainty,
    disclaimer: "Elapsed time is dependency- and resource-constrained; useful lanes do not imply linear speedup.",
  };
}

function round(value: number): number { return Math.round(value * 10) / 10; }
