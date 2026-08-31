---
title: "Phase 12 cutover execution runbook"
description: "Operational runbook for executing the Phase 12 legacy cutover gate once the owner approves budget/live environment. Gate contract: plans/260831-0115-s12-phase12-cutover-gate."
status: pending
priority: P2
created: 2026-08-31
---

# Phase 12 cutover execution runbook

Companion to the [Phase 12 gate contract](plans/260831-0115-s12-phase12-cutover-gate/plan.md).
This runbook executes cutover ONLY when the contract entry conditions are met
(budget approved, live environment available, independent pre-gate arbiter
READY). It must never run from a controlled evidence checkout.

## Hard preflight (all must pass here, reused at every step)

```powershell
# identity + tree
git rev-parse --abbrev-ref HEAD          # must be a release worktree, not master-controlled
git status --porcelain                    # must be empty
# toolkit available (failover restored, master 88c1dc3)
Test-Path scripts/controller-failover.ps1
# focused regression gate
npx --no-install tsx --test qa/tests/s10-*.test.ts   # 33/33
# go plane builds (blocker fix required first: module path)
go build ./... && go vet ./...
```

If any check fails: stop, record the failing byte, stay on the rollback branch.

## Sequence

1. **Snapshot + pin**: freeze `master` (or release branch) byte set, record
   SHA-256 of the inventory of the legacy canonical write surface.
2. **Branch for cutover**: `git checkout -b 260831-$d-s12-cutover`; mark the
   automatic rollback branch at this point.
3. **Live canary**: start live monitored canary on the new adapter with real
   SLO/RPO/RTO instrumentation; approve promotion only on threshold pass.
4. **Atomic switch**: flip the canonical-write pointer (the single
   `legacy_writer` flag) as the last step; immediately after the flip, run the
   write-verification receipt (new adapter canonical, legacy inert).
5. **Rollback branch armed**: any verifier/test/monitor/write-check failure →
   run the rollback branch (restore the prior AA pointer), record NO_GO.
6. **Retire legacy**: only after N clean observation cycle, retire the disabled
   legacy writer path (remove/`inert` the surface), second write-verification.
7. **Evidence chain**: cutover receipt + live drill receipt + rollback drill
   receipt + security/privacy receipt; current-byte pins.
8. **Independent Phase 12 arbiter** (fresh session, not packet author):
   GO → `CLOSED_GO` record, then controller Finalize. NO_GO → retain, diagnose.

## Artifacts expected at close

- `plans/reports/s12/s12-cutover-receipt.md`
- `plans/reports/s12/s12-live-canary-receipt.md` (real SLO/RPO/RTO)
- `plans/reports/s12/s12-rollback-drill-receipt.md`
- `plans/reports/s12/s12-security-review-receipt.md`
- `plans/reports/s12/s12-CLOSED_GO-record.md`
- `plans/handoffs/s12-next-controller-handoff.md`

## Invariants while executing

- `legacy_writer` stays `disabled` until the atomic flip; flips only once; goes
  back on any gate failure. `phase_21: blocked` until a Phase 12-specific
  approved GO.
- No simulated/loopback evidence substitutes for live-verified evidence.
- No secret, credential, or private content in any artifact.

JOB_DONE: none — runbook prepared for owner approval; no cutover executed.