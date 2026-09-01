---
phase: 1
title: "Baseline and runtime contract"
status: pending
priority: P1
effort: "1h"
dependencies: []
---

# Phase 1: Baseline and runtime contract

## Overview

Capture the current failure reproducibly, define the process ownership boundary,
and pin the expected Native-runner lifecycle before any repair.

## Requirements

- [x] Reproduce the incorrect path calculation from `scripts/run-s17.ps1` and preserve the failure evidence without changing runtime state.
- [x] Inventory listeners on 3737/3979 and identify only project-owned processes before any start/stop action.
- [x] Define a local store directory, loopback daemon address, readiness timeout, test cleanup rule, and exact-name task boundary for the persistent daemon.
- [x] Record that Windows service installation, production connectivity, release/cutover, legacy enablement, and Phase 21 remain excluded.

## Architecture

`run-s17.ps1` is the parent process. It resolves the repository once from its
own script directory, builds/uses `go/bin/sen-plane.exe`, starts that executable
on loopback with an explicit test-store root, waits for `/healthz`, then starts
the app. The caller owns Ctrl+C/termination; the script owns only the daemon PID
it created. The probe is an external observer and never restarts a daemon.

## Related Code Files

- Read: `scripts/run-s17.ps1`
- Read: `scripts/dev-sen-plane.ps1`
- Read: `scripts/s18-slo-probes.ps1`
- Read: `go/cmd/sen-plane/main.go`
- Create: `plans/260901-1949-s17-runtime-repair-and-s18-observability-recovery/reports/phase-01-baseline.md`

## Implementation Steps

1. Run the smallest read-only reproduction of `$PSScriptRoot` → repo path and compare it to `git rev-parse --show-toplevel`.
2. Inspect ports and existing processes; reuse none and stop none unless the process was started by this plan.
3. Define test-store creation under a unique local temp directory and the persistent task's named local store, each with explicit cleanup/rollback rules.
4. Write the baseline report with actual failure output, expected lifecycle, timeout values, and rollback behavior.

## Todo

- [x] Baseline report names the root defect and its exact reproduction.
- [x] Lifecycle owner, PID capture, readiness condition, and cleanup scope are explicit.

## Success Criteria

- [x] No listener/process was altered during baseline capture.
- [x] The next phase has a testable contract rather than relying on an arbiter narrative.

## Risk Assessment

If ports are already occupied, signal: `netstat` shows a non-plan PID. Response:
do not terminate it; select no alternate default port and report the conflict for
owner direction. If the persistent store cannot be made local and user-scoped,
stop before task installation.
