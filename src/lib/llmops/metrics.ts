import { type RunEnvelope } from "./contracts";

export interface AggregateMetrics {
  totalRuns: number;
  successRuns: number;
  failedRuns: number;
  totalDurationMs: number;
  inputTokens: number;
  outputTokens: number;
  activeBuilders: Set<string>;
}

export function computeMetrics(runs: RunEnvelope[]): AggregateMetrics {
  const metrics: AggregateMetrics = {
    totalRuns: 0,
    successRuns: 0,
    failedRuns: 0,
    totalDurationMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    activeBuilders: new Set<string>()
  };

  for (const run of runs) {
    metrics.totalRuns++;
    
    if (run.status === "succeeded") metrics.successRuns++;
    if (run.status === "failed") metrics.failedRuns++;
    
    if (run.startedAt && run.endedAt) {
      const start = new Date(run.startedAt).getTime();
      const end = new Date(run.endedAt).getTime();
      if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
        metrics.totalDurationMs += (end - start);
      }
    }
    
    if (run.usage) {
      metrics.inputTokens += run.usage.input ?? 0;
      metrics.outputTokens += run.usage.output ?? 0;
    }
    
    if (run.builderId) {
      metrics.activeBuilders.add(run.builderId);
    }
  }
  
  return metrics;
}
