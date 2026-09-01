---
phase: 4
title: "Close gate and handoff"
status: pending
priority: P1
effort: ""
dependencies: [2, 3]
---

# Phase 4: Close gate and handoff

## Overview
Standard S10-S16 independent-arbiter close: prove the packaging commitment on
committed bytes, then record CLOSED_GO and preserve the S16 gates.

## Requirements
- Functional: an independent fresh-session arbiter re-executes the S17 gates on
  committed bytes (clone-checkout, not working tree).
- Non-functional: same evidence discipline as S10-S16 — scrub bearer-like
  values, keep runtime state out of the product branch, no release scope.

## Architecture
N/A — process phase, no new component.

## Related Code Files
- Read: `docs/newsos-master-memory.md` (S16 close pattern, merge hygiene),
  prior CLOSED_GO records under `plans/reports/`, Finalize/controller-failover
  state.

## Implementation Steps
1. Full gate re-run on working tree: `npm run test`, `npm run go:check`,
   `npx tsc --noEmit`, container smoke, and the Phase 2 harness checks
   (`run.ps1` native + `-Container`).
2. Merge-hygiene pass: exclude `plans/reports/orchestrate-*/` runtime state,
   `_tmp-*`, `*.before-recovery.bin` from the commit; confirm `.dockerignore`
   excludes the same on container paths.
3. Commit packaging artifacts only; record the CLOSED_GO report (independent
   arbiter on committed bytes) and journal lifecycle events; append S17 lessons
   to `docs/newsos-master-memory.md` checkpoint.

## Success Criteria
- [ ] Independent arbiter GO on committed bytes; CLOSED_GO record +
      journal appended.
- [ ] `legacy_writer: disabled`, `phase_21: blocked` preserved; S16 chains
      intact.
- [ ] No release scope, no Phase 21 authority exercised; Finalize still gated
      by the controller-failover state machine.

## Risk Assessment
N/A — proven S10-S16 pattern. One note: do not revive S16's watchdog or
reinstall controller state this sprint; close is close.