/**
 * Offline-only S10 Lane C recovery-drill classifier.  It models whether a
 * recovery condition is safely resumable without contacting a daemon, queue,
 * lease service, backend, or snapshot store.
 */
export type S10LaneCScenario =
  | "daemon-crash"
  | "restore"
  | "duplicate-outbox"
  | "stale-lease"
  | "backend-unavailable"
  | "invalid-snapshot";

export type S10LaneCDrillInput = {
  scenario: S10LaneCScenario;
  frozenInputHash?: string;
  snapshotValid?: boolean;
  leaseFresh?: boolean;
  backendAvailable?: boolean;
  publicationAlreadyRecorded?: boolean;
};

export type S10LaneCDrillResult = {
  status: "replay-required" | "duplicate-suppressed" | "not-measurable" | "fail-closed";
  publication: "none" | "replay-only";
  reason: string;
};

const replayRequired = (reason: string): S10LaneCDrillResult => ({
  status: "replay-required",
  publication: "replay-only",
  reason,
});

const noPublication = (status: "not-measurable" | "fail-closed", reason: string): S10LaneCDrillResult => ({
  status,
  publication: "none",
  reason,
});

/** Classifies a redacted drill input; it performs no recovery action itself. */
export function evaluateS10LaneCRecoveryDrill(input: S10LaneCDrillInput): S10LaneCDrillResult {
  if (!input.frozenInputHash) return noPublication("not-measurable", "frozen-input-hash-unavailable");
  if (input.scenario === "invalid-snapshot" || input.snapshotValid === false) {
    return noPublication("fail-closed", "snapshot-invalid");
  }
  if (input.scenario === "backend-unavailable" || input.backendAvailable === false) {
    return noPublication("not-measurable", "backend-unavailable");
  }
  if (input.scenario === "duplicate-outbox" || input.publicationAlreadyRecorded) {
    return { status: "duplicate-suppressed", publication: "none", reason: "publication-already-recorded" };
  }
  if (input.scenario === "stale-lease" || input.leaseFresh === false) {
    return noPublication("fail-closed", "lease-stale");
  }
  return replayRequired(input.scenario === "daemon-crash" ? "daemon-crash-replay-from-frozen-input" : "restore-replay-from-frozen-input");
}
