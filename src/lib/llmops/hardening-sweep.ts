import { readFile } from "node:fs/promises";
import path from "node:path";

export type HardeningSeverity = "critical" | "high" | "medium";

export interface HardeningFinding {
  surface: string;
  ruleId: string;
  severity: HardeningSeverity;
  evidenceRef: string;
  open: boolean;
  message: string;
}

export interface HardeningSweepReport {
  generatedAt: string;
  surfaces: string[];
  checksRun: number;
  findings: HardeningFinding[];
  openFindings: HardeningFinding[];
}

interface FileCheck {
  surface: string;
  ruleId: string;
  severity: HardeningSeverity;
  file: string;
  mustContain?: string[];
  mustNotContain?: string[];
  message: string;
}

const GUARD = "checkLocalRequest";

// The sweep is a tripwire layer: it catches file deletions, renames, and
// wholesale guard removal. It deliberately runs beneath the dynamic
// origin-guard suite (qa/tests/origin-guard.spec.ts) and per-surface
// integration tests, which prove the guards actually fire.
const SWEEP_CHECKS: readonly FileCheck[] = [
  // Approvals: list/detail/decision/stream reads must never emit raw args.
  {
    surface: "approvals", ruleId: "approval_redaction", severity: "high",
    file: "src/app/api/approvals/route.ts",
    mustContain: ["listRedactedApprovals", GUARD],
    mustNotContain: ["listApprovals("],
    message: "approval list route must serve redacted DTOs behind the local guard",
  },
  {
    surface: "approvals", ruleId: "approval_redaction", severity: "high",
    file: "src/app/api/approvals/[id]/route.ts",
    mustContain: ["toApprovalInboxRow", GUARD],
    mustNotContain: ["item: result.item"],
    message: "approval decision route must redact the returned item",
  },
  {
    surface: "approvals", ruleId: "approval_redaction", severity: "high",
    file: "src/app/api/firstmate/agent/route.ts",
    mustContain: ["redactedApprovalSummary"],
    message: "firstmate park stream must emit redacted hash-bound summaries",
  },
  // Dify: non-canonical adapter stays guarded and behind the enablement gate.
  {
    surface: "dify", ruleId: "route_guard_coverage", severity: "critical",
    file: "src/app/api/integrations/dify/enable/route.ts",
    mustContain: [GUARD],
    message: "dify enable route must be guarded",
  },
  {
    surface: "dify", ruleId: "route_guard_coverage", severity: "critical",
    file: "src/app/api/integrations/dify/runs/[runId]/route.ts",
    mustContain: [GUARD, "assertDifyEnabled"],
    message: "dify run routes must be guarded and gated by enablement",
  },
  {
    surface: "dify", ruleId: "privacy_redaction", severity: "critical",
    file: "src/lib/llmops/ledger.ts",
    mustContain: ["assertDifyEnabled"],
    message: "ledger must gate dify producer events behind enablement",
  },
  // Kanban: dispatch and transition are mutating and must be guarded.
  {
    surface: "kanban", ruleId: "route_guard_coverage", severity: "high",
    file: "src/app/api/agent-kanban/dispatch/route.ts",
    mustContain: [GUARD],
    message: "kanban dispatch must be guarded",
  },
  {
    surface: "kanban", ruleId: "route_guard_coverage", severity: "high",
    file: "src/app/api/agent-kanban/cards/[id]/transition/route.ts",
    mustContain: [GUARD],
    message: "kanban card transition must be guarded",
  },
  // Scheduler: run/fire/wake endpoints are mutating and must be guarded.
  {
    surface: "scheduler", ruleId: "route_guard_coverage", severity: "high",
    file: "src/app/api/automations/[id]/run/route.ts",
    mustContain: [GUARD],
    message: "automation run trigger must be guarded",
  },
  {
    surface: "scheduler", ruleId: "route_guard_coverage", severity: "high",
    file: "src/app/api/firstmate/schedule-wake/route.ts",
    mustContain: [GUARD],
    message: "schedule wake must be guarded",
  },
  // Memory: all retrieval endpoints are credential-adjacent reads.
  {
    surface: "memory", ruleId: "memory_acl_rls", severity: "high",
    file: "src/app/api/memory/search/route.ts",
    mustContain: [GUARD],
    message: "memory search must be guarded",
  },
  {
    surface: "memory", ruleId: "memory_acl_rls", severity: "high",
    file: "src/app/api/memory/log/route.ts",
    mustContain: [GUARD],
    message: "memory log writes must be guarded",
  },
  // Learning plane: evaluations and knowledge surfaces.
  {
    surface: "learning-plane", ruleId: "route_guard_coverage", severity: "high",
    file: "src/app/api/sen/evaluations/route.ts",
    mustContain: [GUARD],
    message: "evaluations endpoints must be guarded",
  },
  {
    surface: "learning-plane", ruleId: "route_guard_coverage", severity: "high",
    file: "src/app/api/sen/knowledge/route.ts",
    mustContain: [GUARD],
    message: "knowledge endpoint must be guarded",
  },
  // Code Space: terminal/pane control surfaces.
  {
    surface: "code-space", ruleId: "route_guard_coverage", severity: "high",
    file: "src/app/api/herdr/terminal/route.ts",
    mustContain: [GUARD],
    message: "herdr terminal surface must be guarded",
  },
  {
    surface: "code-space", ruleId: "route_guard_coverage", severity: "high",
    file: "src/app/api/herdr/launch/route.ts",
    mustContain: [GUARD],
    message: "herdr launch surface must be guarded",
  },
  // Repo intake: trust policy and builder preflight secret rejection.
  {
    surface: "repo-intake", ruleId: "repository_trust", severity: "critical",
    file: "../go/internal/security/repositorytrust/policy.go",
    mustContain: ["ValidateFetchSpec", "QuarantineCheckout"],
    message: "repository trust policy must gate fetch and quarantine checkout",
  },
  {
    surface: "repo-intake", ruleId: "secret_transport", severity: "critical",
    file: "../go/internal/builderexec/preflight.go",
    mustContain: ["untrusted repository must not receive builder secrets", "secretref://"],
    message: "builder preflight must reject raw secrets and require opaque refs",
  },
  // Release orchestration: gate report surface and release-check command.
  {
    surface: "release-orchestration", ruleId: "observability_coverage", severity: "medium",
    file: "src/lib/llmops/release-gate.ts",
    mustContain: ["buildReleaseGateReport", "REQUIRED_RELEASE_COVERAGE"],
    message: "release gate report builder must exist",
  },
  {
    surface: "release-orchestration", ruleId: "route_guard_coverage", severity: "high",
    file: "src/app/api/sen/operations/route.ts",
    mustContain: ["release-gate", "release-check", GUARD],
    message: "release-check commands must be guarded",
  },
];

export async function runHardeningSweep(projectRoot: string, options: { now?: Date } = {}): Promise<HardeningSweepReport> {
  const root = path.resolve(projectRoot);
  const findings: HardeningFinding[] = [];

  for (const check of SWEEP_CHECKS) {
    const evidenceRef = path.join(root, check.file);
    let content: string;
    try {
      content = await readFile(evidenceRef, "utf8");
    } catch {
      findings.push(finding(check, `sweep target is missing: ${check.file}`));
      continue;
    }
    for (const needle of check.mustContain ?? []) {
      if (!content.includes(needle)) {
        findings.push(finding(check, `${check.message} (missing ${JSON.stringify(needle)})`));
      }
    }
    for (const needle of check.mustNotContain ?? []) {
      if (content.includes(needle)) {
        findings.push(finding(check, `${check.message} (forbidden ${JSON.stringify(needle)} present)`));
      }
    }
  }

  const surfaces = [...new Set(SWEEP_CHECKS.map((check) => check.surface))].sort();
  return {
    generatedAt: (options.now ?? new Date()).toISOString(),
    surfaces,
    checksRun: SWEEP_CHECKS.length,
    findings,
    openFindings: findings.filter((item) => item.open),
  };
}

function finding(check: FileCheck, message: string): HardeningFinding {
  return {
    surface: check.surface,
    ruleId: check.ruleId,
    severity: check.severity,
    evidenceRef: check.file,
    open: true,
    message,
  };
}
