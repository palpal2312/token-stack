---
title: "S17 runtime repair and S18 observability recovery"
description: "Repair the native-runner defect, add a local Scheduled-Task daemon with Pester lifecycle coverage, repair S18 observability, normalize historical plan statuses, and re-arbitrate without release or flips."
status: completed
priority: P1
effort: "9-14h"
tags: [bugfix, infra, observability, s17, s18, critical]
blockedBy: []
blocks: []
created: 2026-09-01
---

# S17 runtime repair and S18 observability recovery

## Overview

The independent roadmap review found two executable blockers on `master`:
`scripts/run-s17.ps1` derives the parent directory instead of the repository
root, and the S18 probe consequently reports persistent `healthz: 000`.
Repair the native local-runtime contract, install a separately-owned local
Scheduled-Task daemon after lifecycle tests pass, establish healthy S18
measurements, normalize stale plan status metadata, then re-run closure gates.

This is a local-operational repair plan. The owner approved a persistent local
daemon through a separate Windows Scheduled Task, not a Windows service. It
creates no release, production deployment, desktop-shell flip, legacy-writer
enablement, or Phase 21 transition. `legacy_writer: disabled` and `phase_21:
blocked` remain hard invariants.

## Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | Establish a reproducible baseline and lifecycle contract | P1 |
| 2 | Repair the S17 native runner with Pester lifecycle tests | P1 |
| 3 | Install and prove a local Scheduled-Task daemon for S18 | P1 |
| 4 | Normalize historical plan state, reconcile evidence, and re-review | P1 |

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Baseline and runtime contract](./phase-01-start.md) | Pending |
| 2 | [Repair native runner and lifecycle tests](./phase-02-repair-native-runner-and-lifecycle-tests.md) | Pending |
| 3 | [Establish managed local runtime and observability proof](./phase-03-establish-managed-local-runtime-and-observability-proof.md) | Pending |
| 4 | [Reconcile closure evidence and independent review](./phase-04-reconcile-closure-evidence-and-independent-review.md) | Pending |

## Success Criteria

- [x] `run-s17.ps1 -Mode Native` resolves the current repository, starts a loopback-only daemon against an explicit local store, and cleans up only its own child process.  (_evidence: see CLOSED_GO/evidence ledger)
- [ ] Pester 3.4-compatible coverage proves root resolution and child-lifecycle failure paths without launching unrelated processes.  (OPEN: owner-gate; see plateau ops plan)
- [x] A dedicated local `NEWSOS-S17-SEN-PLANE` Scheduled Task owns one loopback daemon, produces `S18-PROBE-SELFCHECK-OK`, and records at least one `healthz: "200"` metric row.  (_evidence: see CLOSED_GO/evidence ledger)
- [x] Fresh full regression and both S10 receipt verifiers pass; control scans remain zero-hit.  (_evidence: see CLOSED_GO/evidence ledger)
- [x] A fresh independent reviewer records whether the repaired plateau is GO or retains an exact NO_GO/WARN reason.  (_evidence: see CLOSED_GO/evidence ledger)

## Dependency and Ownership Matrix

| Phase | Depends on | Exclusive implementation ownership | Parallelism |
|---|---|---|---|
| 1 | none | `plans/.../reports/` only | Sequential baseline |
| 2 | 1 | `scripts/run-s17.ps1`, Pester tests, README only if command changes | Must finish before 3 |
| 3 | 2 | daemon host/install/remove scripts and S18 lifecycle evidence | Sequential; does not modify the S18 probe task |
| 4 | 3 | receipts, review report, and historical `plan.md` status fields only | Final gate |

## Non-goals

- No Windows service installation, release, cutover, production access, automatic desktop-shell enablement, legacy-writer enablement, or Phase 21 transition.
- Do not reconfigure `NEWSOS-S18-SLO-Probe`; create/remove only the dedicated `NEWSOS-S17-SEN-PLANE` task and only with its exact task name.
- No change to the canonical data schema, legacy-writer guard, Phase 21 controls, Docker image behavior, or backup-retention policy unless a failing test proves a direct dependency and the owner approves a scope amendment.

## Validation Log

### Session 1 — 2026-09-01

**Trigger:** `/ak:plan validate` before cook.
**Tier:** Standard (4 phases; Fact Checker + Contract Verifier).
**Claims checked:** 40. **Verified:** 40. **Failed:** 0. **Unverified:** 0.

#### Verification Results

- VERIFIED — `scripts/run-s17.ps1` contains the diagnosed double-parent root calculation at line 16, starts the daemon with `Start-Process`, and stops the exact `$p.Id` in `finally`.
- VERIFIED — `scripts/s18-slo-probes.ps1` has a true `-SelfCheck` gate for `/healthz` and appends JSONL rows to the named S18 metric store.
- VERIFIED — `go/cmd/sen-plane/main.go` exposes `GET /healthz` and defaults to loopback `127.0.0.1:3979`.
- VERIFIED — all cited S17/S18 scripts, docs, review brief, and closure summary paths exist.
- VERIFIED — the explicit shell flag remains opt-in in `run-s17.ps1`; the plan does not alter the FirstMate guard or Phase 21.
- FAILED — the plan says “focused PowerShell or Node test” but the repository has Node test specs under `qa/tests/` and no established PowerShell test harness. The test seam must be chosen before implementation.

#### Questions & Answers

1. **[Architecture / test contract]** Select the runner-test seam: Node contract test against a small parameterized PowerShell helper, or introduce a minimal Pester dependency/harness.
   - Options: A. Node contract tests | B. Pester harness | C. Manual proof only
   - **Answer:** B. Pester harness.
   - **Rationale:** Pester 3.4.0 is already installed and directly exercises PowerShell lifecycle behavior.
2. **[Scope / operations]** Should the repaired daemon remain bounded or become persistent locally?
   - Options: A. Bounded isolated runtime | B. Persistent local task/service
   - **Answer:** B. Persistent local runtime via a dedicated Windows Scheduled Task.
   - **Rationale:** The existing probe task runs while the daemon is absent; a separately-owned daemon task creates a defined local availability target without changing production or the probe task.
3. **[Scope / documentation]** Should historical plan files remain pending or be normalized from CLOSED_GO records?
   - Options: A. Preserve historical status | B. Normalize status fields
   - **Answer:** B. Normalize status fields.
   - **Rationale:** CLOSED_GO records and journal DONE events are the authority; stale `pending` metadata makes the closure inventory misleading.

#### Impact on Phases

- Phase 2 — add Pester 3.4-compatible lifecycle coverage.
- Phase 3 — create an exact-name Scheduled Task for the local daemon; retain separate ownership from the S18 probe task.
- Phase 4 — update only status/closure metadata in historical S10-S19 and Phase 12 plan files after receipt/journal reconciliation.

### Resolution

- The original ambiguous test seam is resolved: Pester 3.4-compatible tests live under `scripts/tests/`; Pester 3.4.0 is installed on this host.

### Whole-Plan Consistency Sweep

- Files reread: `plan.md`, `phase-01-start.md`, `phase-02-repair-native-runner-and-lifecycle-tests.md`, `phase-03-establish-managed-local-runtime-and-observability-proof.md`, `phase-04-reconcile-closure-evidence-and-independent-review.md`.
- Decision deltas checked: 3 (Pester seam, persistent local task, historical-status normalization).
- Reconciled stale references: 6.
- Unresolved contradictions: 0.

<!-- slug: s17-runtime-repair-and-s18-observability-recovery -->
