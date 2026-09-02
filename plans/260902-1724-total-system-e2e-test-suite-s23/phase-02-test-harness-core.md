---
title: "Phase 2: Test harness core: rewrite robust script"
status: completed
priority: P1
dependencies: [1]
---

# Phase 2: Test harness core

## Overview

Rewrite `scripts/run-total-tests.ps1` as the robust single-pass harness. Fixes
the null-`Path` token bug, makes container steps SKIP-able, and keeps the
`Invoke-Step` pass/fail/receipt shell from the draft.

## Requirements

- Functional: runs static suites (npm test, go:check, tsc, protected:check,
  pester) + S22 rehearsal unconditionally; live overlay only when a container is
  found or `-SkipLive` is absent.
- Non-functional: no `Join-Path` call may receive a null path; token resolution
  null-guards `$env:AGENTIC_OS_HOME`; exit 1 on any FAIL; JSON receipt written.
- PS 5.1 compatible (no `SkipHttpErrorCheck`); no `\x{…}` regex escapes.

## Related Code Files

- Modify: `scripts/run-total-tests.ps1` (rewrite of the 9-step draft).

## Implementation Steps

1. `Get-OrchToken()` helper: resolve `~/.agentic-os/api-token` first, then
   `$env:AGENTIC_OS_HOME\api-token` only if non-empty; return `$null` when both
   miss (caller fails that step cleanly).
2. `Get-Status` fix: invoke via `& $sb` (not splat); wrap to be `-TimeoutSec`-safe.
3. Live overlay guard: `docker ps --filter name=newsos-s22-prod` → if absent and
   `-not $SkipLive`, mark step SKIP with reason instead of FAIL.
4. Keep `Invoke-Step` reporting + summary + JSON receipt writer from the draft.
5. Keep the `phase_21: closed_g0` guard PASS assertion and a `prove-it-scans`
   negative check (see phase 4) wired in.

## Todo

- [x] Rewrite script with above fixes.
- [x] `-SkipLive` run: 6 static steps PASS, 3 live steps SKIP, exit 0.
- [x] Default run: 6 static steps PASS, 3 live steps SKIP when the container has no host port mapping.

## Success Criteria

- Script runs both modes cleanly; no null-path errors; token helper never throws;
  exit code matches verdict; receipt JSON has `verdict` field.
