# S17/S18 runtime repair receipt — 2026-09-01

Status: `READY_FOR_OWNER_COMMIT`

## Current workspace evidence

- Base `HEAD`: `06cd3d4` (no commit was created by this controller).
- Native runner and task contract Pester suites: `18 passed / 0 failed`.
- JavaScript regression: `npm run test` — `58 passed / 0 failed`.
- Go: `go build ./...`, `go vet ./...`, and
  `go test ./internal/... ./cmd/sen-plane` — all exited `0`.
- TypeScript: `npx --no-install tsc --noEmit -p tsconfig.json` — exited `0`.
- S10 receipt chains: Phase 5 closeout verifier `PASS` (8 hashes) and current-byte
  close packet verifier `PASS` (25 hashes).
- Control scan for `legacy_writer: enabled` and `phase_21: enabled` in `src/` and
  `go/`: `0` hits. No release, cutover, or flip was performed.

## Local runtime lifecycle

- The sole intended S17 daemon is owned by Scheduled Task
  `NEWSOS-S17-SEN-PLANE`, binds only `127.0.0.1:3979`, and uses only
  `%LOCALAPPDATA%\NEWSOS\sen-plane\scheduled-store`.
- The task was started, stopped, recovered, elevated-removed for a rollback
  proof, and elevated-reinstalled. Post-reinstall `/healthz` returned `200`.
- `scripts/s18-slo-probes.ps1 -SelfCheck` returned
  `S18-PROBE-SELFCHECK-OK healthz=200 metrics=True` while that task was healthy.
- Redacted S18 rows prove both states: healthy
  `2026-09-01T16:21:02.8084322Z` (`healthz: "200"`, `rpo_min: -1`) and rollback
  DOWN rows beginning `2026-09-01T16:25:24.1850779Z` (`healthz: "000"`).
  `rpo_min: -1` is explicitly unavailable because no durable chat write was
  manufactured for this drill.
- `NEWSOS-S18-SLO-Probe` remained Running and was not registered, removed, or
  otherwise changed by this repair.

## Historical reconciliation

- All eleven CLOSED_GO records are present: S10 under
  `plans/reports/sprint10/` plus S11–S19 and Phase 12 under `plans/reports/`.
- The orchestration journal contains matching `DONE` events. Historical plan
  frontmatter alone was normalized from `pending` to `completed`; no CLOSED_GO
  record or historical requirement was rewritten.

## Gate

The repaired bytes and evidence are ready for independent review and an
owner-created commit. This receipt intentionally does not claim a committed
master verdict, because the owner instructed this controller not to commit.
