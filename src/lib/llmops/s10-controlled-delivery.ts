/**
 * S10 advisory-only controlled-delivery state machine.
 *
 * This is intentionally pure and in-memory: it cannot dispatch work, persist a
 * candidate, call a network service, or promote/cut over a result. Its only
 * output is a deterministic record a controller may inspect.
 */

export type S10CandidateStatus =
  | "awaiting-approval"
  | "rejected"
  | "canary-running"
  | "canary-passed"
  | "rolled-back"
  | "superseded";

export interface S10Candidate {
  candidateId: string;
  baselineSha256: string;
  status: S10CandidateStatus;
  approval: "pending" | "approved" | "rejected";
  canary: {
    maxObservations: number;
    observed: number;
    alert: boolean;
  } | null;
  supersededBy: string | null;
}

export interface S10ControlledDelivery {
  candidate: S10Candidate;
  advisory: true;
  effect: "none";
}

const SHA256 = /^[a-f0-9]{64}$/i;
const IDENTIFIER = /^[a-z0-9][a-z0-9-]{0,63}$/;

function copy(candidate: S10Candidate): S10Candidate {
  return { ...candidate, canary: candidate.canary ? { ...candidate.canary } : null };
}

function requireIdentifier(value: string, name: string): void {
  if (!IDENTIFIER.test(value)) throw new Error(`${name} must be a bounded lowercase identifier.`);
}

function requireSha256(value: string): void {
  if (!SHA256.test(value)) throw new Error("baselineSha256 must be a 64-character SHA-256 hex value.");
}

function result(candidate: S10Candidate): S10ControlledDelivery {
  return { candidate: copy(candidate), advisory: true, effect: "none" };
}

/** A newly proposed candidate is always inert until an explicit approval. */
export function proposeS10Candidate(candidateId: string, baselineSha256: string): S10ControlledDelivery {
  requireIdentifier(candidateId, "candidateId");
  requireSha256(baselineSha256);
  return result({
    candidateId,
    baselineSha256: baselineSha256.toLowerCase(),
    status: "awaiting-approval",
    approval: "pending",
    canary: null,
    supersededBy: null,
  });
}

/** Rejecting is valid and inert; only a pending candidate can receive a decision. */
export function decideS10Candidate(
  state: S10ControlledDelivery,
  decision: "approve" | "reject",
): S10ControlledDelivery {
  const candidate = copy(state.candidate);
  if (candidate.status !== "awaiting-approval" || candidate.approval !== "pending") {
    throw new Error("candidate is not awaiting an approval decision.");
  }
  if (decision === "reject") {
    candidate.approval = "rejected";
    candidate.status = "rejected";
  } else {
    candidate.approval = "approved";
  }
  return result(candidate);
}

/** Starts a bounded observational canary only after explicit approval. */
export function startS10Canary(
  state: S10ControlledDelivery,
  maxObservations: number,
): S10ControlledDelivery {
  const candidate = copy(state.candidate);
  if (candidate.status !== "awaiting-approval" || candidate.approval !== "approved") {
    throw new Error("explicit approval is required before a canary can start.");
  }
  if (!Number.isSafeInteger(maxObservations) || maxObservations < 1 || maxObservations > 100) {
    throw new Error("maxObservations must be an integer between 1 and 100.");
  }
  candidate.status = "canary-running";
  candidate.canary = { maxObservations, observed: 0, alert: false };
  return result(candidate);
}

/**
 * Records one bounded monitor observation. An alert fails closed; reaching the
 * fixed bound without one creates only advisory canary evidence.
 */
export function monitorS10Canary(
  state: S10ControlledDelivery,
  observation: { alert: boolean },
): S10ControlledDelivery {
  const candidate = copy(state.candidate);
  if (candidate.status !== "canary-running" || !candidate.canary) {
    throw new Error("candidate has no running canary.");
  }
  if (candidate.canary.observed >= candidate.canary.maxObservations) {
    throw new Error("canary observation bound has already been reached.");
  }
  candidate.canary.observed += 1;
  candidate.canary.alert ||= observation.alert;
  if (candidate.canary.alert) candidate.status = "rolled-back";
  else if (candidate.canary.observed === candidate.canary.maxObservations) candidate.status = "canary-passed";
  return result(candidate);
}

/** Return to the exact pinned baseline without changing any external state. */
export function rollbackS10Candidate(state: S10ControlledDelivery): S10ControlledDelivery {
  const candidate = copy(state.candidate);
  if (["rejected", "rolled-back", "superseded"].includes(candidate.status)) {
    throw new Error("candidate cannot be rolled back from its terminal state.");
  }
  candidate.status = "rolled-back";
  return result(candidate);
}

/**
 * Supersession cannot inherit approval or canary results: its replacement
 * returns as a fresh candidate awaiting its own explicit approval.
 */
export function supersedeS10Candidate(
  state: S10ControlledDelivery,
  replacementId: string,
  replacementBaselineSha256: string,
): { superseded: S10ControlledDelivery; replacement: S10ControlledDelivery } {
  requireIdentifier(replacementId, "replacementId");
  if (replacementId === state.candidate.candidateId) throw new Error("replacementId must differ from candidateId.");
  if (["rejected", "rolled-back", "superseded"].includes(state.candidate.status)) {
    throw new Error("candidate cannot be superseded from its terminal state.");
  }
  const candidate = copy(state.candidate);
  candidate.status = "superseded";
  candidate.supersededBy = replacementId;
  return { superseded: result(candidate), replacement: proposeS10Candidate(replacementId, replacementBaselineSha256) };
}
