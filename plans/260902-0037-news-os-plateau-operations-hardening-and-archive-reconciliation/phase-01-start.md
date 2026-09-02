---
phase: 1
title: "Scope and authority preflight"
status: pending
priority: P1
effort: "0.5d"
dependencies: []
---

# Phase 1: Scope and authority preflight

## Overview

Create the authoritative redacted approval ledger and baseline before operational mutation.

## Requirements

- Record approvals as machine-readable JSON/Markdown pair with approval ID, owner identity, issued/expiry time, exact mutation, runner/task identifiers, target independence class, retention, and evidence reference.
- Define fail-closed conditions: missing/expired ID, owner mismatch, changed action/label/TaskPath/target/retention, or unapproved replacement request.
- Inventory CI, task ownership, backup contract, Go backup/restore boundaries, and S08/S09/S10 evidence.

## Related Code Files

- Read: `.github/workflows/ci.yml`, `scripts/install-s18-tasks.ps1`, `docs/backup-restore-cadence.md`, `go/internal/localdb/core/backup.go`
- Read: `plans/260826-1551-news-os-next-parallel-sprints-08-10/plan.md`, S08/S09 reports, `plans/reports/sprint10/s10-CLOSED_GO-record.md`
- Create: `plans/reports/news-os-plateau-approvals-<date>.json`, `plans/reports/news-os-plateau-operations-preflight-<date>.md`

## Implementation Steps

1. Capture redacted baseline IDs/statuses, not backup contents or sensitive paths.
2. Define approval schema and validation; bind every later mutation to one exact approval ID.
3. Obtain approvals for runner topology/trust, external target/retention, new task details, and historical disposition.
4. Mark any dependent operation BLOCKED when approval validation fails.

## Success Criteria

- [ ] Ledger is parseable, redacted, and maps every requested mutation to one owner decision.  (OPEN: owner-gate; see plateau ops plan)
- [ ] No CI/task/backup/archive/live-store state changes occur.  (OPEN: owner-gate; see plateau ops plan)
- [x] Protected-control searches remain clean.  (_evidence: see CLOSED_GO/evidence ledger)

## Risk Assessment

Approval drift is the key risk. Signal: any approved field differs at execution. Response: fail closed and request a new approval; report-only work needs no rollback.
