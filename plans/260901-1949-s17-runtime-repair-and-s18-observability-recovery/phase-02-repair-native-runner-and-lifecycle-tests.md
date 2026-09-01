---
phase: 2
title: "Repair native runner and Pester lifecycle tests"
status: pending
priority: P1
effort: "2-3h"
dependencies: [1]
---

# Phase 2: Repair native runner and lifecycle tests

## Overview

Correct the root-resolution defect and protect the Native runner’s build, health,
and child-cleanup lifecycle with Pester 3.4-compatible regression coverage.

## Requirements

- [x] Resolve the repository from `Split-Path $PSScriptRoot -Parent` and validate it against a sentinel (`package.json`, `go/`, and Git top-level) before spawning a child.
- [x] Preserve explicit opt-in behavior for `DESKTOP_SHELL_V2`; the default must remain unset/OFF.
- [x] Capture the daemon child PID and stop only that exact PID in `finally`, including app-launch or readiness failure.
- [x] Fail before app startup when Go build, daemon start, or `/healthz` readiness fails; include a bounded timeout and useful error.

## Architecture

Do not add a second daemon manager. Keep `run-s17.ps1` as the one-command
entrypoint; extract only local PowerShell helpers if needed for testability. Add
Pester 3.4-compatible tests under `scripts/tests/`; mock process launch for unit
paths and use a unique disposable store/port for one bounded integration case.

## Related Code Files

- Modify: `scripts/run-s17.ps1`
- Create: `scripts/tests/run-s17.Tests.ps1`
- Create only if needed to expose test seams: `scripts/lib/run-s17-runtime.ps1`
- Modify only if invocation wording changes: `README.md`
- Do not modify: `src/app/api/firstmate/chat/route.ts`, any Phase 21 path, Docker behavior

## Implementation Steps

1. Write Pester 3.4-compatible failing cases for path resolution, missing sentinels, build failure, readiness timeout, app failure, cleanup ownership, and shell-flag default.
2. Implement single-parent root resolution plus sentinel validation.
3. Add explicit child-process capture/readiness polling; use `try/finally` for exact-PID cleanup and return the original failure.
4. Verify `-Shell` remains the only code path that sets `DESKTOP_SHELL_V2=1`.
5. Run `Invoke-Pester scripts/tests/run-s17.Tests.ps1`, then `npm run test`, Go build/vet/tests, and `tsc`.

## Todo

- [x] Tests fail on the pre-fix script and pass on the repaired script.
- [x] The runner uses the Git root and resolves `source\go\bin\sen-plane.exe`.
- [x] No cleanup selector can match an unrelated user process.

## Success Criteria

- [x] Native launcher reaches a loopback `/healthz` on a disposable local store in a bounded test.
- [x] Default shell flag remains OFF and legacy/Phase 21 scans remain zero-hit.

## Risk Assessment

Readiness testing can leave orphan processes. Signal: test PID remains after
the test exits. Response: fail the test and repair exact-PID cleanup; never use
image-name or broad command-line process kills.
