---
title: "S11 rewrite stabilization and first delivery"
description: "Sprint 11: bring the split rewrite (feat/rewrite-baseline) to merge quality and land the first vertical slice behind the desktop-shell flag."
status: completed
priority: P1
effort: ""
tags: [s11, rewrite, desktop-shell, go-plane]
created: 2026-08-31
---

# S11 rewrite stabilization and first delivery

## Overview

Sprint 10 closed as **GO** (CLOSED_GO, master `923c447`). The 361-file rewrite
was restored and split into 17 topic commits on `feat/rewrite-baseline`
(review: `plans/reports/review-260831-0206-rewrite-baseline-split.md`), with a
**merge verdict of NOT_READY**. Sprint 11 removes those blockers, merges the
reviewed topics, and delivers the first flag-gated vertical slice. Scope is
build and review only; release/cutover stays under the Phase 12 gate
(contract + runbook prepared) and `legacy_writer: disabled`, `phase_21:
blocked` remain hard invariants.

## Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | Merge-readiness: go build/vet green, shell emit() fix, unit tests wired, settings fabricated-data removed, SQL migration dedup, TOCTOU/feedback fixes | P1 |
| 2 | Topic-by-topic review and merge of `feat/rewrite-baseline` into `master` | P1 |
| 3 | First vertical slice live behind `desktop_shell_v2` flag with evidence + gate | P1 |

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | Merge-readiness fixes (go build/vet, shell emit(), tests, fabricated-data removal, SQL dedup, TOCTOU/feedback) | Pending |
| 2 | Topic-by-topic review and incremental merge of `feat/rewrite-baseline` | Pending |
| 3 | Desktop-shell vertical slice behind `desktop_shell_v2` | Pending |
| 4 | Close gate (independent arbiter) and handoff | Pending |

## Implementation steps (phase working notes will be added under `plans/260831-0206-s11-*` as each phase opens)

1. Fix blockers from the review report on `feat/rewrite-baseline`, one topic at a time.
2. Re-run `go build ./... && go vet ./...`, node:test suites, and the S10 regression suites.
3. Review each of the 17 topic commits; merge incrementally to `master` with per-merge evidence.
4. Enable `desktop_shell_v2` behind a monitored flag for the slice, gather redacted evidence.
5. Run the independent S11 close-gate arbiter; record GO or NO_GO, then hand off.

## Success criteria

- [ ] `go build ./... && go vet ./...` pass on merged tree; shell stores emit on
      every mutator; node:test suites present for shell/web clusters; no
      fabricated data on any live surface.
- [ ] `feat/rewrite-baseline` review topics merged to `master` with per-topic
      review evidence; S10 chain receipts remain current-byte verified.
- [ ] Desktop-shell slice observable behind the flag with a redacted evidence
      receipt; default-off surface stays byte-equivalent to the legacy shell.
- [ ] Close gate (independent arbiter) records S11 GO or explicit NO_GO with the
      same fail-closed pattern as S10; `legacy_writer: disabled`, `phase_21:
      blocked`, no release/cutover.

## Ownership

This plan owns only `plans/260831-0206-s11-*`. Build work happens on
`feat/rewrite-baseline` and merge to `master` proceeds only after per-phase gate
evidence. Phase 12 cutover remains out of scope and un-owned by this sprint.

<!-- slug: s11-rewrite-stabilize-and-deliver -->
