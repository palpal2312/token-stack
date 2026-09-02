---
title: "NEWS OS plateau operations preflight"
date: 2026-09-02
plan: "260902-0037-news-os-plateau-operations-hardening-and-archive-reconciliation"
status: "partial-pass"
---

# NEWS OS plateau operations preflight

## Decisions recorded

The owner approved both GitHub-hosted and self-hosted CI. Self-hosted runs must use `newsos-docker-isolated` and only run for `master` push or `workflow_dispatch`; they must never run for `pull_request`.

The owner selected a 30-day, current-user-ACL backup at a redacted target whose canonical-path SHA-256 is `c81d0e0d135bcd89bf8f4525ed235f1f83d428731cee16c90c078f9d0cfacd4f` and explicitly accepted the same-volume exception. The target is on `C:`, the same NTFS volume as the live scheduled S17 store; it is therefore not an independent failure domain.

The owner selected `retain-pending` for S08/S09 historical disposition.

## Baseline

| Surface | Observed state | Decision / gate |
|---|---|---|
| `NEWSOS-S17-SEN-PLANE` | Running | Protected; no replacement permitted. |
| `NEWSOS-S18-SLO-Probe` | Ready | Protected; Phase 3 must not alter its installer/task. |
| `NEWSOS-Plateau-Backup-Cadence` | Absent | May only be created after its conditional approval becomes valid. |
| Backup target | Absent; `C:` NTFS; canonical-path hash recorded in approval ledger | Same-volume exception recorded; encryption and ACL remain unverified. |
| BitLocker status | Unavailable without elevation | `Get-BitLockerVolume` and `manage-bde -status C:` were denied. |
| Protected controls | No `legacy_writer: enabled` or `phase_21: enabled` match under `src/` or `go/` | Must remain clean. |
| CI `container-smoke` | `ubuntu-latest`, fixed port, raw log tail | Phase 2 will harden this only under `PLATEAU-CI-260902-01`. |

## Approval matrix

| ID | Scope | Status | Consequence |
|---|---|---|---|
| `PLATEAU-CI-260902-01` | CI container smoke | Approved | Phase 2 may proceed while unexpired and after exact-field checks. |
| `PLATEAU-BACKUP-260902-02` | Backup cadence and isolated restore | Conditional | Phase 3 is blocked until encryption, pre-existing-root ACL, action, and trigger proofs exist. |
| `PLATEAU-HISTORY-260902-03` | S08/S09 disposition | Approved | Phase 4 may proceed with `retain-pending`. |

## Fail-closed rules

- Any expired ID, owner mismatch, changed runner label/ref policy, changed TaskPath/action/trigger/principal, changed target, or changed retention blocks the affected mutation.
- Encryption verification requires an elevated, read-only check. A same-volume target is accepted only as an explicitly recorded exception, not as evidence of independent recovery. The target root must be created by the owner before Phase 3 and pass an ACL check before any backup mutation.
- No backup bytes, secrets, environment values, or raw container logs may enter this report or Git.

## Next state

Phase 2 and Phase 4 are eligible for their separate approvals. Phase 3 remains blocked; it may not create a task, target root, backup cycle, or restore runtime until elevated encryption proof, a pre-existing-root ACL proof, an exact approved task action, and an exact approved trigger all exist.
