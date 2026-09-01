# S18 Phases 1-3 — observability receipt

## Status
DONE. P1: `scripts/s18-slo-probes.ps1` — loop 30s probing `/healthz` (2-consec
fails), RPO via durable chat read-back (>5m breach log), RTO (>15m), JSONL
series to `%LOCALAPPDATA%\NEWSOS\s12-metrics\slo.jsonl`, `-SelfCheck` assertion
mode. P2: `GET /api/ops/metrics` (tail N rows) + `/ops/observability` dashboard
page (last-state table; no chart lib). P3: `scripts/install-s18-tasks.ps1` —
registers NEWSOS-S18-SLO-Probe scheduled task (30m safety detector) + backup
cadence hash verification (sha256sum -c newest cycle).

## Verification
tsc 0 · both PS scripts parse (PS 5.1) · thresholds per ops-prep 1d.

JOB_DONE: S18 P1-3 delivered; close gate next.
