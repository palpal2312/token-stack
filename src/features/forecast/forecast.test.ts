import assert from "node:assert/strict";
import test from "node:test";
import { buildForecast } from "./forecast";

test("forecast presents every frozen assumption and respects critical path", () => {
  const result = buildForecast({ sequentialWorkHours:100, criticalPathHours:20, usefulLaneRange:{min:3,max:5}, reviewRetryAllowanceHours:4, resourceAssumptions:{workerClass:"standard",maxConcurrentWorkers:5}, hourlyCostRange:{min:1,max:2}, sampleSize:60, uncertainty:0.15, cohortSupported:true });
  assert.equal(result.sequentialWork.hours, 100);
  assert.equal(result.criticalPath.hours, 20);
  assert.deepEqual(result.usefulLaneRange, {min:3,max:5});
  assert.equal(result.reviewRetryAllowance.hours, 4);
  assert.equal(result.resourceAssumptions.workerClass, "standard");
  assert.deepEqual(result.costRange, {min:104,max:208,currency:"USD"});
  assert.equal(result.confidence, "high");
  assert.ok(result.elapsedTimeInterval.minHours >= 24);
  assert.match(result.disclaimer, /do not imply linear speedup/);
});

test("sparse or unsupported cohorts are low-confidence and out-of-distribution", () => {
  const result = buildForecast({ sequentialWorkHours:40, criticalPathHours:30, usefulLaneRange:{min:1,max:2}, reviewRetryAllowanceHours:5, resourceAssumptions:{workerClass:"constrained",maxConcurrentWorkers:2}, hourlyCostRange:{min:1,max:3}, sampleSize:2, uncertainty:0.8, cohortSupported:false });
  assert.equal(result.confidence, "low");
  assert.equal(result.distributionStatus, "out-of-distribution");
  assert.ok(result.elapsedTimeInterval.maxHours > result.elapsedTimeInterval.minHours);
});
