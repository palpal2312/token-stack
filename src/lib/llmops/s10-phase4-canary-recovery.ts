import {
  decideS10Candidate,
  monitorS10Canary,
  proposeS10Candidate,
  rollbackS10Candidate,
  startS10Canary,
  supersedeS10Candidate,
  type S10ControlledDelivery,
} from "./s10-controlled-delivery";
import { evaluateS10LaneCRecoveryDrill, type S10LaneCDrillInput } from "./s10-lane-c-recovery-drill";

/**
 * Deterministic Phase 4 evidence model. It exercises only supplied redacted
 * observations and simulated failure inputs. It has no live-service, daemon,
 * queue, writer, or release authority.
 */
export interface S10CanaryThresholds {
  maxObservations: number;
  maxErrorRate: number;
  maxLatencyRatio: number;
}

export interface S10CanaryObservation {
  errorRate: number;
  latencyRatio: number;
}

export interface S10Phase4Input {
  candidateId: string;
  baselineSha256: string;
  approval: "approve" | "reject";
  thresholds: S10CanaryThresholds;
  observations: readonly S10CanaryObservation[];
  recovery: readonly S10LaneCDrillInput[];
  slo: { maxCanaryDurationMs: number; rpoMs: number; rtoMs: number };
}

export interface S10Phase4Result {
  mode: "simulated-redacted";
  delivery: S10ControlledDelivery;
  outcome: "rejected-no-op" | "canary-passed-advisory" | "rolled-back";
  recovery: ReturnType<typeof evaluateS10LaneCRecoveryDrill>[];
  slo: { status: "within-bounds" | "outside-bounds"; rpoMs: number; rtoMs: number };
  publication: "none";
  live: false;
}

function validUnit(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} must be a finite ratio between 0 and 1.`);
}

function validPositive(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive safe integer.`);
}

function alertFor(observation: S10CanaryObservation, thresholds: S10CanaryThresholds): boolean {
  validUnit(observation.errorRate, "errorRate");
  if (!Number.isFinite(observation.latencyRatio) || observation.latencyRatio < 0) throw new Error("latencyRatio must be a non-negative finite number.");
  return observation.errorRate > thresholds.maxErrorRate || observation.latencyRatio > thresholds.maxLatencyRatio;
}

/**
 * Runs one bounded, simulated delivery sequence. Approval rejection is an
 * explicit no-op. A threshold breach rolls the candidate back to its pinned
 * baseline. A passing simulation remains advisory and cannot promote.
 */
export function evaluateS10Phase4CanaryRecovery(input: S10Phase4Input): S10Phase4Result {
  validPositive(input.thresholds.maxObservations, "maxObservations");
  validUnit(input.thresholds.maxErrorRate, "maxErrorRate");
  if (!Number.isFinite(input.thresholds.maxLatencyRatio) || input.thresholds.maxLatencyRatio < 0) {
    throw new Error("maxLatencyRatio must be a non-negative finite number.");
  }
  validPositive(input.slo.maxCanaryDurationMs, "maxCanaryDurationMs");
  validPositive(input.slo.rpoMs, "rpoMs");
  validPositive(input.slo.rtoMs, "rtoMs");
  if (input.observations.length > input.thresholds.maxObservations) throw new Error("observation count exceeds the fixed canary bound.");

  const proposed = proposeS10Candidate(input.candidateId, input.baselineSha256);
  const recovery = input.recovery.map(evaluateS10LaneCRecoveryDrill);
  if (input.approval === "reject") {
    return {
      mode: "simulated-redacted", delivery: decideS10Candidate(proposed, "reject"), outcome: "rejected-no-op", recovery,
      slo: { status: "within-bounds", rpoMs: input.slo.rpoMs, rtoMs: input.slo.rtoMs }, publication: "none", live: false,
    };
  }

  let delivery = startS10Canary(decideS10Candidate(proposed, "approve"), input.thresholds.maxObservations);
  for (const observation of input.observations) {
    delivery = monitorS10Canary(delivery, { alert: alertFor(observation, input.thresholds) });
    if (delivery.candidate.status === "rolled-back") break;
  }
  const elapsedMs = input.observations.length;
  const slo = { status: elapsedMs <= input.slo.maxCanaryDurationMs ? "within-bounds" as const : "outside-bounds" as const, rpoMs: input.slo.rpoMs, rtoMs: input.slo.rtoMs };
  if (delivery.candidate.status === "rolled-back") {
    return { mode: "simulated-redacted", delivery: rollbackNotNeeded(delivery), outcome: "rolled-back", recovery, slo, publication: "none", live: false };
  }
  if (delivery.candidate.status !== "canary-passed") throw new Error("canary requires the full bounded observation set before an advisory result.");
  return { mode: "simulated-redacted", delivery, outcome: "canary-passed-advisory", recovery, slo, publication: "none", live: false };
}

/** Shows that a superseding proposal is fresh and cannot inherit approval. */
export function simulateS10Phase4Supersession(input: Pick<S10Phase4Input, "candidateId" | "baselineSha256">, replacementId: string, replacementBaselineSha256: string) {
  return supersedeS10Candidate(decideS10Candidate(proposeS10Candidate(input.candidateId, input.baselineSha256), "approve"), replacementId, replacementBaselineSha256);
}

function rollbackNotNeeded(delivery: S10ControlledDelivery): S10ControlledDelivery {
  // Alert handling already set the state to rolled-back. Calling the explicit
  // rollback transition again would correctly reject a terminal state.
  return delivery;
}
