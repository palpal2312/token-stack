---
phase: 3
title: "Automated backup cadence and isolated restore verification"
status: pending
priority: P1
effort: "1-2d"
dependencies: [1]
---

# Phase 3: Automated backup cadence and isolated restore verification

## Overview

Create a separate approved backup cadence task; it never alters the S18 installer/task by default.

## Requirements

- New task only: `NEWSOS-Plateau-Backup-Cadence` at `\\NEWSOS\\`; no replacement of an existing task.
- Owner-approved principal must be current-user `Interactive` with `Limited` run level; exact TaskPath/name/action/trigger/principal drift checks block execution.
- External target definition includes independence class, encryption/ACL requirement, authenticated manifest/provenance method, retention, and approval ID; no target credential enters code/report.
- Canonical path containment rejects reparse points/symlinks/junctions and TOCTOU escape; all create/delete paths must remain children of canonical approved root.
- Per-cycle exclusive lock, stale-lock recovery rule, collision-resistant cycle IDs, no cleanup of pre-existing partials, and retention excluding active/current cycles.
- Restore uses unique isolated store, daemon port, and PID proof; it never targets live scheduled store.
- Change Go only after a direct defect-reproduction test proves an API defect; otherwise implement orchestration only.

## Related Code Files

- Create: `scripts/run-newsos-plateau-backup-cadence.ps1`, `scripts/tests/newsos-plateau-backup-cadence.Tests.ps1`
- Modify: `docs/backup-restore-cadence.md`
- Read: `scripts/install-s18-tasks.ps1`, `go/internal/localdb/core/backup.go`, `go/internal/localdb/core/backup_test.go`, `go/internal/localdb/product/database_test.go`
- Modify only with defect test: `go/cmd/sen-plane/...`, `go/internal/localdb/core/backup.go`
- Create: `plans/reports/news-os-backup-restore-drill-<date>.md`

## Implementation Steps

1. Validate approval; inspect exact task identity and abort if `NEWSOS-Plateau-Backup-Cadence` already exists rather than replacing it.
2. Resolve canonical root and validate each path component against reparse/symlink/junction traversal before open/create/delete; revalidate handles/parents immediately before mutation.
3. Acquire exclusive per-cycle lock; recover only an objectively stale lock under approved rule and use collision-resistant IDs/staging that never deletes a pre-existing partial.
4. Create encrypted/ACL-compliant external cycle, authenticated provenance/manifest, verify from manifest root, then atomically promote.
5. Restore to a new isolated root, start isolated daemon on unique port, record PID/port/store proof, validate approved endpoint, terminate PID, and remove only that isolated root.
6. Apply retention only after full success; protect active/current cycles and fail closed on ambiguous candidates.
7. Register the exact new task only after approval and assert TaskPath/action/trigger/principal values post-registration; document manual mode if unapproved.

## Success Criteria

- [ ] No S18 task or pre-existing task is changed.
- [ ] Task identity/principal/action/trigger match approval or the run blocks.
- [ ] Cycle verification and isolated daemon restore proof pass without touching live store.
- [ ] Tests cover containment, reparse/TOCTOU defenses, locking, collision/partial preservation, retention protection, and failed restore/manifest behavior.
- [ ] Go remains unchanged unless a direct failing defect test justified it.

## Risk Assessment

Path confusion and destructive retention are severe. Signal: canonical/path revalidation mismatch, existing task/cycle, live-store match, ambiguous lock, or candidate outside root. Response: hard-fail without delete/restore and preserve all data. Rollback: disable only the new task by exact identity.
