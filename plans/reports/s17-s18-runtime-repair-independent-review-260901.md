# Independent review — S17/S18 runtime repair (2026-09-01)

Reviewer scope: fresh, read-only review of committed candidate `d0b549a003f61e8c8dfbf237532ff91c46e22920` and permitted local runtime state. No code, Scheduled Task configuration, release, cutover, or feature flag was changed by this review. The S18 `-SelfCheck` command was run as the defined observability gate.

## Verdicts

### Committed repair candidate — PASS

Reason: `HEAD` is `d0b549a003f61e8c8dfbf237532ff91c46e22920` (`fix: recover local s17 runtime observability`), and its committed tree includes the repaired native runner, dedicated daemon host/task contract, Pester coverage, and Phase 03 receipt.

Evidence: `git rev-parse HEAD`; `git diff-tree --name-only -r d0b549a` includes `scripts/run-s17.ps1`, `scripts/s17-daemon-host.ps1`, `scripts/tests/run-s17.Tests.ps1`, and `plans/260901-1949-s17-runtime-repair-and-s18-observability-recovery/reports/phase-03-observability-receipt.md`.

### Regression suite — PASS

Reason: Every executable regression command required by the review brief passed against the current candidate bytes.

Evidence: `npm run test` = 58 passed / 0 failed; `go build ./...`, `go vet ./...`, and `go test ./internal/... ./cmd/sen-plane` exited 0; `npx --no-install tsc --noEmit -p tsconfig.json` exited 0; `Invoke-Pester -Path scripts/tests` = 18 passed / 0 failed.

### S10 receipt chains — PASS

Reason: Both current-byte receipt-verifier gates matched every pinned hash.

Evidence: `.claude/skills/newos-master/scripts/newos-receipt-verify.ps1` returned `PASS` for `plans/reports/sprint10/s10-phase5-closeout-receipt.md` (8 hashes) and `plans/reports/sprint10/s10-phase5-current-byte-close-packet.md` (25 hashes).

### S17 persistent-local lifecycle — PASS

Reason: The exact dedicated task owns one loopback daemon and the daemon is currently healthy.

Evidence: `NEWSOS-S17-SEN-PLANE` is `Running`; its exported task action invokes `scripts/s17-daemon-host.ps1` with only `C:\Users\ADMIN\AppData\Local\NEWSOS\sen-plane\scheduled-store` and `127.0.0.1:3979`. `Get-NetTCPConnection` found one listener on that address, owned by PID 12828; its command line is this repository's `go\bin\sen-plane.exe`; `GET /healthz` returned 200.

### S18 observability recovery — PASS

Reason: The existing S18 task remains running and independently observes the current daemon as healthy.

Evidence: `NEWSOS-S18-SLO-Probe` is `Running`; `scripts/s18-slo-probes.ps1 -SelfCheck` returned `S18-PROBE-SELFCHECK-OK healthz=200 metrics=True`; the last five `%LOCALAPPDATA%\NEWSOS\s12-metrics\slo.jsonl` samples each have `healthz: "200"` and `consec_fails: 0`. The rollback DOWN proof remains recorded in `plans/260901-1949-s17-runtime-repair-and-s18-observability-recovery/reports/phase-03-observability-receipt.md`.

### Protected controls and no release/cutover — PASS

Reason: The protected controls remain absent from executable source and the task is limited to the local daemon contract.

Evidence: `rg -n 'legacy_writer: enabled|phase_21: enabled' src go` returned 0 hits. The task action has no release, cutover, desktop-shell, legacy-writer, or Phase 21 capability. The Phase 03 and repair receipts record no release, cutover, or flip.

### Historical closure reconciliation — PASS

Reason: All eleven CLOSED_GO records are present and matching status-only plan metadata is committed with the repair candidate.

Evidence: recursive inventory found 11 `*CLOSED_GO-record.md` files: S10, S11–S19, and Phase 12. The status-only plan metadata changes are present in `d0b549a`; the supporting receipt is `plans/reports/s17-s18-runtime-repair-receipt-260901.md`.

### Residual owner risks — WARN

Reason: Historical rehearsal language and the review brief's Docker-runner and backup-cadence limitations are not release authority and were not altered by this repair.

Evidence: `plans/reports/session-112-phase-21-release-rehearsal.md`; `plans/reports/review-brief-260901-roadmap-s10-s19.md` sections 3–4. These do not contradict the current protected-control scan or authorize a release.

## Final

`REVIEWED PASS`

The repair is present in committed candidate `d0b549a` and all required current functional, receipt, task-ownership, loopback-health, S18, and protected-control gates pass. This verdict is not release, cutover, legacy-writer enablement, desktop-shell enablement, or Phase 21 authorization.

Status: DONE

Summary: Fresh committed-candidate review passes; S17 is task-owned and healthy, S18 observes healthy samples, and all required regression and receipt gates pass.

Concerns/Blockers: Non-blocking owner risks remain limited to historical non-authoritative rehearsal wording and pre-existing Docker/backup verification limits; no repair gate is blocked.
