import type { ForecastResult } from "./forecast";

export function ForecastCard({ forecast }: { forecast: ForecastResult }) {
  return <section aria-label="Execution forecast">
    <h3>Execution forecast</h3>
    <dl>
      <dt>Sequential work</dt><dd>{forecast.sequentialWork.hours} agent-hours</dd>
      <dt>Critical path</dt><dd>{forecast.criticalPath.hours} hours</dd>
      <dt>Useful lanes</dt><dd>{forecast.usefulLaneRange.min}–{forecast.usefulLaneRange.max}</dd>
      <dt>Estimated elapsed time</dt><dd>{forecast.elapsedTimeInterval.minHours}–{forecast.elapsedTimeInterval.maxHours} hours</dd>
      <dt>Review/retry allowance</dt><dd>{forecast.reviewRetryAllowance.hours} hours</dd>
      <dt>Resources</dt><dd>{forecast.resourceAssumptions.workerClass}; up to {forecast.resourceAssumptions.maxConcurrentWorkers} workers</dd>
      <dt>Estimated cost</dt><dd>${forecast.costRange.min}–${forecast.costRange.max}</dd>
      <dt>Confidence</dt><dd>{forecast.confidence}{forecast.distributionStatus === "out-of-distribution" ? " / out of distribution" : ""}</dd>
    </dl>
    <p>{forecast.disclaimer}</p>
  </section>;
}
