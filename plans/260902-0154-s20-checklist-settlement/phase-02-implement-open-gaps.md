---
phase: 2
title: "Implement OPEN gaps"
status: pending
priority: P1
effort: ""
dependencies: [1]
---

# Phase 2: Implement OPEN gaps

## Overview
Close the implementable OPEN items; explicitly classify external/owner-gated
ones (Docker exec, production flips, named approvals).

## Requirements
- S17: move/copy runner to root `run.ps1` (Windows) keeping `scripts/run-s17.ps1`
  delegation; add a native-smoke execution receipt; leave `docker build`/`run`
  and CI container job marked external (needs Docker runner) with the exact
  commands re-verified in CI only.
- S18: add `-RunOnce` and `-WriteVerify` to `s18-slo-probes.ps1`; add a
  fake-server test for the 2-consec alert; add monthly rotation for the JSONL;
  add `s18-backup-cadence.ps1` (dedicated) with hash-verify cadence; dashboard
  keeps last-state table (marked partial).
- S15: make the run harness set canonical env by default (Native) with
  `-Legacy` escape, or record explicit owner decision to keep opt-in; decide
  pnpm vs npm once (fix CI winner + plan line).
- S16: verify empty-store UI states render (live probe with a fresh store).
- Approvals: add named approver + date lines to the S19/1809 enable receipt.
- P12: annotate lease-not-held as expected (failover state machine configured
  but unclaimed between runs) — footer note in the gate plan.

## Related Code Files
- Modify: scripts/s18-slo-probes.ps1, scripts/install-s18-tasks.ps1 (new helper
  scripts), run.ps1 (new root), src/app/ops/observability/page.tsx (empty-state),
  plans/* receipts for approvals.

## Implementation Steps
1. Implement each with a lean patch + focused check.
2. External/owner ones → record as explicit EXTERNAL markers in the checklist
   (not silently closed).

## Success Criteria
- [ ] Implementable OPEN items done with receipts.
- [ ] External/owner items marked EXTERNAL with the reason; none fabricated as done.

## Risk Assessment
Scope creep into product — mitigation: files-only + scripts only; no data
migration, no flips.