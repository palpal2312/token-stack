export type ObservabilityEntryKind = "metric" | "trace_field" | "health_component";
export type ObservabilityCoverageStatus = "green" | "amber";

export const OBSERVABILITY_RELEASE_COVERAGE_MARKER = "observability-catalog:required-for-release" as const;

export interface ObservabilityCatalogEntry {
  kind: ObservabilityEntryKind;
  name: string;
  ownerPhase: number;
  requiredForRelease: boolean;
  description: string;
}

export interface ObservabilityCoverageReport {
  marker: typeof OBSERVABILITY_RELEASE_COVERAGE_MARKER;
  status: ObservabilityCoverageStatus;
  registered: boolean;
  required: Record<ObservabilityEntryKind, string[]>;
  missing: Record<ObservabilityEntryKind, string[]>;
  reasons: string[];
}

function metric(name: string, description: string, ownerPhase = 20): ObservabilityCatalogEntry {
  return { kind: "metric", name, ownerPhase, requiredForRelease: true, description };
}

function traceField(name: string, description: string, ownerPhase = 20): ObservabilityCatalogEntry {
  return { kind: "trace_field", name, ownerPhase, requiredForRelease: true, description };
}

function healthComponent(name: string, description: string, ownerPhase = 20): ObservabilityCatalogEntry {
  return { kind: "health_component", name, ownerPhase, requiredForRelease: true, description };
}

export const REQUIRED_OBSERVABILITY_CATALOG: readonly Readonly<ObservabilityCatalogEntry>[] = freezeEntries([
  metric("redaction_class_count", "Counts redaction classes observed before persistence/export."),
  metric("local_only_denial_count", "Counts local-only/token guard denials."),
  metric("direct_listener_auth_failure_count", "Counts direct Go listener auth/capability/nonce failures."),
  metric("append_conflict_count", "Counts append/CAS/fence conflicts."),
  metric("replay_quarantine_count", "Counts replay and corrupt-tail quarantine recoveries."),
  metric("orphan_recovery_count", "Counts orphan process/job/sandbox recoveries."),
  metric("stale_fence_rejection_count", "Counts stale fence-generation write rejections."),
  metric("repository_quarantine_count", "Counts repository trust quarantine decisions."),
  metric("secret_ref_resolve_failure_count", "Counts opaque secret-ref resolution failures."),
  metric("memory_acl_rls_denial_count", "Counts memory ACL/RLS authorization denials."),
  metric("deterministic_policy_downgrade_block_count", "Counts deterministic policy blocks of unsafe downgrades."),
  metric("exporter_failure_count", "Counts observability exporter failures without dropping canonical append."),
  metric("backup_verify_failure_count", "Counts verified backup replay mismatches."),
  metric("route_guard_coverage_count", "Counts guarded routes covered by release evidence."),
  metric("approval_redaction_violation_count", "Counts approval list/detail/decision/stream redaction violations."),
  metric("agentenv_auth_denial_count", "Counts AgentENV auth wrapper denials."),
  metric("sandbox_egress_denial_count", "Counts deny-by-default sandbox egress denials."),
  metric("sandbox_orphan_duplicate_count", "Counts sandbox orphan and duplicate detections."),
  metric("template_artifact_digest_failure_count", "Counts template/image/artifact digest failures."),
  metric("sandbox_quota_ttl_violation_count", "Counts sandbox quota and TTL violations."),

  traceField("run_id", "Canonical run identifier attached to spans and events."),
  traceField("task_id", "Canonical Task identifier for Kanban/runtime correlation."),
  traceField("attempt_id", "Canonical Attempt identifier for retry/fence correlation."),
  traceField("builder_id", "Builder identity for allocation/runtime attribution."),
  traceField("source_kind", "Source channel kind for taint and policy auditing."),
  traceField("redaction_class", "Highest redaction class on the event/span payload."),
  traceField("policy_id", "Policy decision identifier or version."),
  traceField("grant_id", "Trusted capability/memory/secret grant identifier."),
  traceField("fence_generation", "Lease/fence generation observed by the operation."),
  traceField("repo_id", "Registered repository identity for fetch/worktree operations."),
  traceField("decision_hash", "Deterministic policy decision hash."),

  healthComponent("storage", "Ledger/snapshot storage health from HealthReporter.", 4),
  healthComponent("migrations", "Migration registry lock/load health.", 2),
  healthComponent("scheduler", "Scheduler/queue dispatch health.", 10),
  healthComponent("exporter", "Telemetry exporter fail-open health.", 20),
  healthComponent("index", "Derived index/projection rebuild health.", 4),
  healthComponent("release_gate", "Phase 20 release-gate computation health.", 20),
  healthComponent("sandbox_provider", "AgentENV/direct provider health and attestation state.", 8),
]);

export class ObservabilityCatalog {
  private readonly entries = new Map<string, ObservabilityCatalogEntry>();

  constructor(entries: Iterable<Readonly<ObservabilityCatalogEntry>> = REQUIRED_OBSERVABILITY_CATALOG) {
    for (const entry of entries) this.register(entry);
  }

  register(entry: Readonly<ObservabilityCatalogEntry>): void {
    validateEntry(entry);
    this.entries.set(keyOf(entry), copyEntry(entry));
  }

  registerMetric(name: string, ownerPhase: number, description: string, requiredForRelease = true): void {
    this.register({ kind: "metric", name, ownerPhase, description, requiredForRelease });
  }

  registerTraceField(name: string, ownerPhase: number, description: string, requiredForRelease = true): void {
    this.register({ kind: "trace_field", name, ownerPhase, description, requiredForRelease });
  }

  registerHealthComponent(name: string, ownerPhase: number, description: string, requiredForRelease = true): void {
    this.register({ kind: "health_component", name, ownerPhase, description, requiredForRelease });
  }

  entriesFor(kind?: ObservabilityEntryKind): ObservabilityCatalogEntry[] {
    return [...this.entries.values()]
      .filter((entry) => !kind || entry.kind === kind)
      .map(copyEntry)
      .sort((left, right) => left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name));
  }

  getReleaseGateCoverage(required: readonly Readonly<ObservabilityCatalogEntry>[] = REQUIRED_OBSERVABILITY_CATALOG): ObservabilityCoverageReport {
    const missing: Record<ObservabilityEntryKind, string[]> = { metric: [], trace_field: [], health_component: [] };
    const requiredNames: Record<ObservabilityEntryKind, string[]> = { metric: [], trace_field: [], health_component: [] };

    for (const entry of required) {
      validateEntry(entry);
      if (!entry.requiredForRelease) continue;
      requiredNames[entry.kind].push(entry.name);
      const registered = this.entries.get(keyOf(entry));
      if (!registered || !registered.requiredForRelease) missing[entry.kind].push(entry.name);
    }

    for (const kind of Object.keys(missing) as ObservabilityEntryKind[]) {
      missing[kind].sort();
      requiredNames[kind].sort();
    }
    const missingCount = Object.values(missing).reduce((sum, values) => sum + values.length, 0);
    return {
      marker: OBSERVABILITY_RELEASE_COVERAGE_MARKER,
      status: missingCount === 0 ? "green" : "amber",
      registered: missingCount === 0,
      required: requiredNames,
      missing,
      reasons: missingCount === 0
        ? []
        : [`${missingCount} required observability catalog entries are missing`],
    };
  }
}

export function getReleaseGateCoverage(entries: Iterable<Readonly<ObservabilityCatalogEntry>> = REQUIRED_OBSERVABILITY_CATALOG): ObservabilityCoverageReport {
  return new ObservabilityCatalog(entries).getReleaseGateCoverage();
}

function freezeEntries(entries: ObservabilityCatalogEntry[]): readonly Readonly<ObservabilityCatalogEntry>[] {
  return Object.freeze(entries.map((entry) => Object.freeze(copyEntry(entry))));
}

function copyEntry(entry: Readonly<ObservabilityCatalogEntry>): ObservabilityCatalogEntry {
  return { ...entry };
}

function keyOf(entry: Pick<ObservabilityCatalogEntry, "kind" | "name">): string {
  return `${entry.kind}:${entry.name}`;
}

function validateEntry(entry: Readonly<ObservabilityCatalogEntry>): void {
  if (!entry || typeof entry !== "object") throw new Error("observability catalog entry is required");
  if (!entry.name || typeof entry.name !== "string") throw new Error("observability catalog entry name is required");
  if (!/^[a-z][a-z0-9_]*$/.test(entry.name)) throw new Error(`observability catalog entry name is invalid: ${entry.name}`);
  if (!Number.isInteger(entry.ownerPhase) || entry.ownerPhase < 1 || entry.ownerPhase > 21) {
    throw new Error(`observability catalog owner phase is invalid for ${entry.name}`);
  }
  if (!entry.description.trim()) throw new Error(`observability catalog description is required for ${entry.name}`);
}
