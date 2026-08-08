import { access } from "node:fs/promises";
import path from "node:path";
import type { LedgerRecoveryReport } from "./ledger";
import {
  OBSERVABILITY_RELEASE_COVERAGE_MARKER,
  getReleaseGateCoverage,
  type ObservabilityCoverageReport,
} from "./observability-catalog";

export type ReleaseGateStatus = "green" | "amber" | "blocked";

export interface RequiredCoverageEntry {
  ruleId: string;
  suiteName: string;
}

export interface CoverageCheck {
  ruleId: string;
  suiteName: string;
  present: boolean;
}

/**
 * Recovery evidence the release gate consumes (phase 20: LedgerRecoveryReport
 * and the backup verify result are gate inputs, not optional reports). Both
 * are optional so read-only callers can report coverage without running a
 * recovery; when present they are always evaluated.
 */
export interface RecoveryGateInputs {
  /** Result of RunLedger.recover(); a quarantined tail downgrades to amber. */
  ledgerRecovery?: LedgerRecoveryReport;
  /** Result of a verified backup; a failed verification blocks the gate. */
  backupVerify?: { ok: boolean; error?: string };
}

export interface ReleaseGateReport {
  status: ReleaseGateStatus;
  canCutover: boolean;
  generatedAt: string;
  requiredCoverage: RequiredCoverageEntry[];
  coverage: CoverageCheck[];
  missingCoverage: CoverageCheck[];
  observability: ObservabilityCoverageReport;
  recovery: {
    replayedEvents: number;
    quarantinedTail: boolean;
    backupVerified: boolean | null;
  } | null;
  reasons: string[];
}

export const REQUIRED_RELEASE_COVERAGE: readonly RequiredCoverageEntry[] = Object.freeze([
  { ruleId: "direct_listener_auth", suiteName: "qa/tests/go-listener-authz.spec.ts" },
  { ruleId: "secret_transport", suiteName: "qa/tests/secret-transport.spec.ts" },
  { ruleId: "repository_trust", suiteName: "qa/tests/repository-trust.spec.ts" },
  { ruleId: "taint_policy", suiteName: "qa/tests/policy-taint.spec.ts" },
  { ruleId: "recovery_and_fencing", suiteName: "qa/tests/llmops-reliability.spec.ts" },
  { ruleId: "recovery_and_fencing", suiteName: "qa/tests/agentenv-recovery.spec.ts" },
  { ruleId: "approval_redaction", suiteName: "qa/tests/approval-redaction.spec.ts" },
  { ruleId: "memory_acl_rls", suiteName: "qa/tests/memory-acl-rls.spec.ts" },
  { ruleId: "sandbox_isolation", suiteName: "qa/tests/agentenv-security.spec.ts" },
  { ruleId: "privacy_redaction", suiteName: "qa/tests/llmops-privacy.spec.ts" },
  { ruleId: "observability_coverage", suiteName: OBSERVABILITY_RELEASE_COVERAGE_MARKER },
]);

export async function buildReleaseGateReport(options: { projectRoot?: string; now?: Date; recovery?: RecoveryGateInputs } = {}): Promise<ReleaseGateReport> {
  const projectRoot = options.projectRoot ? path.resolve(options.projectRoot) : await resolveProjectRoot(process.cwd());
  const observability = getReleaseGateCoverage();
  const coverage: CoverageCheck[] = [];

  for (const item of REQUIRED_RELEASE_COVERAGE) {
    const present = item.suiteName === OBSERVABILITY_RELEASE_COVERAGE_MARKER
      ? observability.registered
      : await fileExists(path.join(projectRoot, item.suiteName));
    coverage.push({ ...item, present });
  }

  const missingCoverage = coverage.filter((item) => !item.present);
  const reasons = [
    ...missingCoverage.map((item) => `missing coverage: ${item.suiteName} (${item.ruleId})`),
    ...observability.reasons.map((reason) => `observability: ${reason}`),
  ];

  // Recovery evidence (phase 20 gate inputs): a failed backup verification is
  // a hard block; a quarantined ledger tail degrades to amber — never green.
  let blocked = false;
  let recovery: ReleaseGateReport["recovery"] = null;
  if (options.recovery) {
    const quarantinedTail = Boolean(options.recovery.ledgerRecovery?.quarantine);
    const backupVerified = options.recovery.backupVerify ? options.recovery.backupVerify.ok : null;
    recovery = {
      replayedEvents: options.recovery.ledgerRecovery?.replayedEvents ?? 0,
      quarantinedTail,
      backupVerified,
    };
    if (backupVerified === false) {
      blocked = true;
      reasons.push(`backup verification failed: ${options.recovery.backupVerify?.error ?? "unknown"}`);
    }
    if (quarantinedTail) {
      reasons.push("ledger recovery quarantined a corrupt tail — reconcile before cutover");
    }
  }

  const status: ReleaseGateStatus = blocked ? "blocked" : reasons.length > 0 ? "amber" : "green";
  return {
    status,
    canCutover: status === "green",
    generatedAt: (options.now ?? new Date()).toISOString(),
    requiredCoverage: REQUIRED_RELEASE_COVERAGE.map((item) => ({ ...item })),
    coverage,
    missingCoverage,
    observability,
    recovery,
    reasons,
  };
}

async function resolveProjectRoot(cwd: string): Promise<string> {
  const current = path.resolve(cwd);
  if (await fileExists(path.join(current, "qa", "tests"))) return current;
  const parent = path.dirname(current);
  if (await fileExists(path.join(parent, "qa", "tests"))) return parent;
  return current;
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
