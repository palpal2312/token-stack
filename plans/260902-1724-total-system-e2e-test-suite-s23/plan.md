---
title: "Total-system E2E test suite (S23)"
description: "Replace the failing run-total-tests.ps1 draft with a complete, robust total-system test harness that runs all static suites, the isolated durability rehearsal, and the live production-container overlay in one pass, writes a JSON receipt, and exits non-zero on any failure."
status: completed
priority: P1
effort: ""
tags: [test, e2e, harness, s23]
created: 2026-09-02
---

# Total-system E2E test suite (S23)

## Overview

Post-Phase-21 the system has many separate gates (npm tests, go suite, tsc,
protected-controls guard, Pester S17 harness, S22 local rehearsal, live
container checks) but no single script runs them end-to-end. A draft
`scripts/run-total-tests.ps1` exists and runs 7/9 PASS but fails its two live
overlay steps with a null-`Path` token bug. This plan rebuilds that script
into the authoritative total-system harness: full coverage, robust token
resolution, deterministic receipt, fail-closed exit code.

## Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | One command runs every system gate in order (static suites → isolated rehearsal → live production container) | P1 |
| 2 | Every step has a real assertion; harness fails closed (exit 1) and tolerates `-SkipLive` when no container is present | P1 |
| 3 | Run full pass green + JSON receipt committed + verify the harness catches a deliberately-broken case (proves it isn't vacuous) | P1 |

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Start: requirements frozen](./phase-01-start.md) | Completed |
| 2 | [Test harness core: rewrite robust script](./phase-02-test-harness-core.md) | Completed |
| 3 | [Live overlay + suite wiring](./phase-03-live-overlay-suiten.md) | Completed |
| 4 | [Run + receipt + close](./phase-04-run-receipt-close.md) | Completed |

## Success Criteria

- [x] `scripts/run-total-tests.ps1` runs every static suite and rehearsal, with live assertions activated only for a host-reachable production container.
- [x] Token resolution never throws on an unset `AGENTIC_OS_HOME`; container checks degrade honestly with `-SkipLive` or no host port mapping.
- [x] Green receipts exist in `plans/reports/`; deliberate marker removal made the harness exit 1, proving the exact guard scan.
- [ ] Script, receipt, and plan are ready to commit; commit remains an owner action.

## Ownership

Owns only `plans/260902-1724-total-system-e2e-test-suite-s23/` + `scripts/run-total-tests.ps1`
(+ any new test helper files). Cook via dynamic workflow (ultracode) as
authorized by owner. No product code change beyond the harness.

<!-- slug: total-system-e2e-test-suite-s23 -->
