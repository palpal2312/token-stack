---
phase: 3
title: "Establish managed local runtime and observability proof"
status: pending
priority: P1
effort: "2h"
dependencies: [2]
---

# Phase 3: Establish managed local runtime and observability proof

## Overview

Install and verify a dedicated local Scheduled-Task daemon for S18, with an
isolated store and exact task ownership distinct from the probe task.

## Requirements

- [x] Create `NEWSOS-S17-SEN-PLANE` only after proving it does not already exist; it starts one loopback `sen-plane` against an explicit local store.
- [x] Run `scripts/s18-slo-probes.ps1 -SelfCheck` while healthy and require `S18-PROBE-SELFCHECK-OK`.
- [x] Collect at least one post-start JSONL row with `healthz: "200"`; if RPO has no durable write, label it unavailable rather than fabricating a value.
- [x] Prove exact-task restart/recovery and rollback/removal; never alter `NEWSOS-S18-SLO-Probe`.
- [x] Record the persistent-local policy; leave no release, cutover, production access, Windows service, legacy enablement, or Phase 21 change.

## Architecture

The daemon remains loopback-only and uses a named local store. A dedicated
`NEWSOS-S17-SEN-PLANE` Scheduled Task owns its process; the existing S18 task
remains a read-only observer. Remove operations target only the exact task/store.

## Related Code Files

- Modify only if a focused test exposes a direct defect: `scripts/s18-slo-probes.ps1`
- Create: `scripts/s17-daemon-host.ps1`
- Create: `scripts/install-s17-daemon-task.ps1`
- Create: `scripts/remove-s17-daemon-task.ps1`
- Create: `scripts/tests/s17-daemon-task.Tests.ps1`
- Create: `plans/260901-1949-s17-runtime-repair-and-s18-observability-recovery/reports/phase-03-observability-receipt.md`
- Read: `scripts/install-s18-tasks.ps1`, `docs/backup-restore-cadence.md`

## Implementation Steps

1. Verify task-name and port ownership; create a named local store with current-user access.
2. Add the exact-name daemon task, start it, record task/PID/log metadata, and wait for loopback 200 healthz.
3. Run self-check; append and inspect healthy metric output.
4. Restart the exact task and verify recovery; remove it in the rollback drill and prove the probe observes DOWN.
5. Reinstall only after rollback proof if the owner wants it left running; preserve production and user stores.

## Todo

- [x] Healthy, restart, and rollback/down samples have separate timestamps and a clear lifecycle receipt.
- [x] The probe never mutates chat/store data to manufacture RPO evidence.

## Success Criteria

- [x] Fresh `-SelfCheck` succeeds during healthy window.
- [x] The only surviving daemon is owned by `NEWSOS-S17-SEN-PLANE`; rollback removes it and leaves no listener.

## Risk Assessment

If a port or task name is occupied or a daemon will not start within the timeout,
signal: non-200 health/readiness. Response: capture logs without secrets, clean
only the exact named task/store, and stop as NO_GO. If a scheduled probe writes
concurrent rows, distinguish rows by timestamp rather than editing metrics.
