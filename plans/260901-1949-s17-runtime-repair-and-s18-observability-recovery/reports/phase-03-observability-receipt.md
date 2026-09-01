# Phase 03 observability receipt

Status: `PASS`

## Boundaries

- Runtime task: `NEWSOS-S17-SEN-PLANE` only.
- Runtime address: `127.0.0.1:3979` only.
- Store: `%LOCALAPPDATA%\NEWSOS\sen-plane\scheduled-store`.
- `NEWSOS-S18-SLO-Probe` remained registered and Running throughout.
- No production access, release, cutover, legacy-writer enablement, or Phase 21 change occurred.

## Lifecycle evidence

- Before installation, the pre-existing unmanaged listener PID 14544 was verified
  as this repository's `go\bin\sen-plane.exe` and stopped only after explicit
  owner authorization.
- The elevated installer registered the exact S17 task. It started and served
  `GET /healthz` with `200`; the first observed task-owned listener PID was 27268.
- `scripts/s18-slo-probes.ps1 -SelfCheck` returned
  `S18-PROBE-SELFCHECK-OK healthz=200 metrics=True`.
- S18 JSONL recorded the healthy sample
  `2026-09-01T16:21:02.8084322Z`, `healthz: "200"`, `rpo_min: -1`.
  The `-1` is retained as unavailable because this drill did not manufacture a
  durable chat write.
- Exact-task stop released port 3979 and returned `healthz=000`.
- Exact-task restart recovered `healthz=200`; the recovered listener PID was 6400.
- The elevated exact-task removal succeeded. Post-removal verification found no
  task and no listener on 3979; `/healthz` returned `000`. The existing S18 probe
  then recorded DOWN samples at `2026-09-01T16:25:24.1850779Z`,
  `2026-09-01T16:25:58.3145751Z`, and `2026-09-01T16:26:32.4188314Z`.

## Final persistent-local state

After the rollback proof, the owner reinstalled the same exact task through an
elevated PowerShell. Final verification started that task, observed listener PID
12828 on loopback 3979, returned `healthz=200`, and repeated
`S18-PROBE-SELFCHECK-OK healthz=200 metrics=True`. The focused S17 Pester suites
passed 18/18 after the final fixed-address/fixed-store regression. The task is
the only intended surviving S17 daemon.
