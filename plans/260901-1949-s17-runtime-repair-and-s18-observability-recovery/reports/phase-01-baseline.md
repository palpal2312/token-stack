# Phase 1 baseline — S17 runtime repair / S18 observability

## Result

Baseline reproduced without changing any process, listener, task, store, or
product code.

## Evidence

- Git root: `C:/Users/ADMIN/Documents/Agent OS/source`.
- `scripts/run-s17.ps1` derives `C:\Users\ADMIN\Documents\Agent OS` by taking
  two parents of its script directory; the required repository root is the
  single parent `C:\Users\ADMIN\Documents\Agent OS\source`.
- Therefore the current runner targets
  `C:\Users\ADMIN\Documents\Agent OS\go\bin\sen-plane.exe`, not the intended
  `source\go\bin\sen-plane.exe`.
- No listening process was present on ports 3737 or 3979 during capture.
- `NEWSOS-S18-SLO-Probe` exists and is running; `NEWSOS-S17-SEN-PLANE` does not
  exist.
- Control scan returned zero hits for `legacy_writer: enabled` and
  `phase_21: enabled` in `src/` and `go/`.

## Lifecycle boundary for the repair

- The future daemon task has one exact name: `NEWSOS-S17-SEN-PLANE`.
- It may use only loopback `127.0.0.1:3979` and a named current-user local store.
- A test store must be unique and disposable. The persistent store must be
  distinct from both test and user stores.
- Readiness is `GET /healthz` = HTTP 200 within a bounded timeout.
- Removal/rollback may stop or remove only the exact named task and its recorded
  child PID; no broad image-name or command-line process matching is allowed.

## Preserved constraints

No release, cutover, production access, desktop-shell flip, legacy-writer
enablement, Phase 21 transition, or change to `NEWSOS-S18-SLO-Probe` occurred.
