/**
 * Evidence-backed Phase 19a U0 contract.
 *
 * This is intentionally presentation-neutral: it records the boundaries that
 * the current prerequisites can prove without claiming a runtime authority,
 * desktop package, or browser-owned configuration schema.
 */
export const DESKTOP_U0_CONTRACT = Object.freeze({
  phase: "19a",
  slice: "U0",
  status: "baseline-recorded",
  executionAuthority: "outside-nextjs",
  desktopPackaging: "deferred",
  configSchemaAuthority: "go-prerequisite-required",
  initialShell: {
    heavyFeatures: "load-on-request",
    workspaceRealtimeListeners: 1,
  },
  evidenceFixture: "qa/fixtures/phase-19a-u0-evidence.json",
  budgetFixture: "qa/fixtures/frontend-performance-budget.json",
} as const);

export type DesktopU0Contract = typeof DESKTOP_U0_CONTRACT;

export function getDesktopU0Contract(): DesktopU0Contract {
  return DESKTOP_U0_CONTRACT;
}
