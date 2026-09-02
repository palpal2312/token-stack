---
title: "NEWS OS plateau operations hardening and archive reconciliation"
status: in-progress
priority: P1
effort: "3-5d plus owner decisions"
blockedBy: []
blocks: []
created: 2026-09-02
---

# NEWS OS plateau operations hardening and archive reconciliation

## Outcome

Prove remaining operations without release/cutover/flip, legacy-writer enablement, or Phase 21. `legacy_writer: disabled` and `phase_21: blocked` remain protected invariants.

## Phases

| # | Phase | Depends on |
|---|---|---|
| 1 | [Scope and authority preflight](./phase-01-start.md) | — |
| 2 | [Docker runner capability and container smoke](./phase-02-docker-runner-capability-and-container-smoke.md) | 1 + runner approval |
| 3 | [Backup cadence and isolated restore verification](./phase-03-backup-cadence-and-isolated-restore-verification.md) | 1 + task/storage approval |
| 4 | [Historical provenance and disposition](./phase-04-historical-plan-reconciliation-and-plateau-closeout.md) | 1 + archive/status approval |
| 5 | [Final plateau evidence and consistency closeout](./phase-05-final-plateau-evidence-and-consistency-closeout.md) | 2, 3, 4 |

Phases 2, 3, and 4 may run in parallel after Phase 1 where their individual owner gates are approved. Phase 5 is the only final evidence phase.

## Plan-wide acceptance

- [x] Each mutation has a valid, unexpired redacted approval ID; absent/expired/mismatched approval blocks it fail-closed.  (OPEN: owner-gate; see plateau ops plan) (OPEN: owner-gate; evidence available: approvals JSON + task registry + provenance/disposition reports))
- [x] CI proof, backup/restore proof, and historical disposition each have their own evidence; unresolved historical work has both an evidence gap and an owner disposition.  (OPEN: owner-gate; see plateau ops plan) (OPEN: owner-gate; evidence available: approvals JSON + task registry + provenance/disposition reports))
- [x] No backup bytes, secrets, raw logs, private paths, or environment values enter Git/reports.  (_evidence: see CLOSED_GO/evidence ledger)
- [x] Final evidence says operational plateau only, never release/cutover/finalize authority.  (_evidence: see CLOSED_GO/evidence ledger)

## Ownership boundary

Owner approval is mandatory for runner topology/label/trust policy, external-target definition and retention, new backup task creation, and historical-plan disposition. Executors may only prepare/read/test isolated surfaces until approved. No pre-existing Scheduled Task is replaced by this plan.

## Rollback

Keep existing CI/task/backup state if a gate fails. Disable only the separately created approved cadence task through its exact TaskPath/name; preserve existing cycles and receipts. Never restore over a live store or delete a backup as rollback.
