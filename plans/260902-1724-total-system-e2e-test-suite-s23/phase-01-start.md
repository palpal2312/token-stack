---
title: "Phase 1: Start: requirements frozen"
status: completed
priority: P1
dependencies: []
---

# Phase 1: Start: requirements frozen

## Overview

Freeze the harness contract: which gates run, in what order, what each step
asserts, and the failure policy. Baseline the current draft (`run-total-tests.ps1`,
7/9 PASS) and enumerate its two live-step bugs so the rewrite fixes them by design.

## Requirements

- [x] Enumerate all existing gates (npm test, go:check, tsc, protected:check, pester, S22 rehearsal, container overlay).
- [x] Record draft failure: live canary + legacy-inert steps hit `Cannot bind argument to parameter 'Path' because it is null` when `AGENTIC_OS_HOME` is unset (`Join-Path $env:AGENTIC_OS_HOME 'api-token'`).
- [x] Fix policy: token resolution null-guards both `$env:AGENTIC_OS_HOME` and `~/.agentic-os/api-token`; skipped live steps are labelled SKIP.
- [x] Failure policy: any real FAIL exits 1 and still writes a receipt.

## Implementation Steps

1. Static inventory already done (scout output above).
2. Confirm the current `run-total-tests.ps1` contents against the frozen contract (rewrite file in phase 2).
3. Record the "prove it scans" check: inject a deliberately-broken token line and assert the harness exits 1.

## Todo

- [x] Publish phase-01 contract (this file is the record).

## Success Criteria

- Contract frozen: steps, assertions, skip policy, exit policy all documented here and honoured by the phase-2 rewrite.
