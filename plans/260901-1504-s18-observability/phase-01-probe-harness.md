---
phase: 1
title: "Probe harness — SLO probes implemented + alert thresholds"
status: pending
priority: P1
effort: ""
dependencies: []
---

# Phase 1: Probe harness — SLO probes implemented + alert thresholds

## Overview
One PowerShell probe script (`scripts/s18-slo-probes.ps1`) implements the four
SLO probes the S12 ops-prep pack mandates, with the exact thresholds from §1d:
Availability (healthz poll every 30s, alert on 2 consecutive fails), RPO (age of
newest durable write vs wall clock, threshold 5m), RTO (failure-signal to
restored, threshold 15m), and a canary write-verification. Every sample is
timestamped. This phase builds the probes and the alert logic only; persistence
to the metrics dir and the dashboard land in Phase 2.

## Requirements
- Functional:
  - Availability: `GET {SEN_PLANE_ADDR}/healthz` every 30s; response must be
    200 with `{"status":"ok"}`. Failure state is sticky-on-N — 2 consecutive
    failures emit an `alert:availability` event and mark a downtime window start.
  - RPO: read the newest durable write in the canonical chat store via the
    daemon's read-back surface (the persisted-chat GET) — use the real PK
    timestamps the store exposes, never synthesized identity (S16 lesson).
    `age = wall clock − newest write CreatedAt`; `age > 5m` emits
    `alert:rpo`. A store with zero writes in the window is reported honestly as
    `pending`, not as a pass (OM-17: missing evidence != PASS).
  - RTO: when an Availability downtime window opens, record `failure_signal_at`; on
    the first successful healthz after that, record `restored_at` and compute
    `rto = restored_at − failure_signal_at`; `rto > 15m` emits `alert:rto`.
  - Write-verification: POST a canary chat turn to
    `POST /api/v1/sen/chat` (gated locale: test fixture env only per S11 lesson —
    no fake writes against a production store), assert a durable receipt
    (`command_id` + `turn_id`) returns within the probe timeout, then confirm the
    legacy path answers the frozen response (410 / config stays gated) — proving
    canonical active, legacy inert (S16 freeze-not-delete).
  - Every probe emits one JSON line: `{ts, metric, value, ok, alert?}`.
- Non-functional:
  - Loopback only: probes hit `SEN_PLANE_ADDR` (default `127.0.0.1`), never an
    external interface.
  - Fail-closed observables match the S16 runtime: a 503/offline daemon is a
    hard availability failure, not a missed sample.
  - No secrets in output: probe logs must not echo `SEN_GO_BUILDER_EXEC_AUTHORITY`,
    `DATABASE_URL`, or token-like env values (ops-prep §1g).
  - Thresholds are constants at the top of the script, set + armed before any
    live run (gate G4), not discovered during it.

## Architecture
- Single script, `scripts/s18-slo-probes.ps1`, runnable two ways:
  - `-RunOnce` — emit one full sample set (Availability + RPO + RTO state +
    optional `-WriteVerify`), used by tests and the dashboard refresh.
  - `-Watch` — the scheduled loop: poll every 30s for the cadence, maintaining
    the sticky failure counter and downtime window in-memory and writing each
    sample out with `-RunOnce` semantics. (Deliberate `ponytail:` the 30s poll
    loop lives in one script; an external agent every 30s is overkill — the
    Watch loop is the probe. Add a watchdog-style separated process only if the
    probe process itself keeps dying.)
- Probe -> daemon read path: RPO reads newest durable write from the daemon's
  persisted-chat GET (returns rows with real `ts`/PK fields, S16 "DTO from source
  of truth"), so the probe never touches the .db file directly and cannot be
  accused of reading its own writes.
- Alert output: a JSON alert event line `{ts, alert, value, detail}` — an
  operator/roller reads these; Phase 2 wires them to the metrics store + a
  visible dashboard state.

## Related Code Files
- Add: `scripts/s18-slo-probes.ps1`.
- Read: `go/cmd/sen-plane/main.go` (healthz handler, persisted-chat GET,
  `/api/v1/sen/chat` POST contract), `scripts/dev-sen-plane.ps1` (how the daemon
  is started locally), `scripts/run-s17.ps1` (native boot harness),
  `plans/260831-0206-s12-phase12-cutover-pack/ops-prep.md` §1d (thresholds are
  the source of truth).
- Test: `scripts/test-s18-slo-probes.ps1` (assert-style, no framework — the
  smallest thing that fails if probe logic breaks: fake health server up/down,
  sticky-failure counter, RTO window math, RPO age math).

## Implementation Steps
1. Add `scripts/s18-slo-probes.ps1` with the four probe functions and the
   top-of-file threshold constants (availability 30s / 2-strike, RPO 5m,
   RTO 15m).
2. Implement probe emit as one JSON line per sample, honoring the timestamp
   requirement (RFC3339) — stdout for tests, file append for Phase 2.
3. Implement `-WriteVerify`: send the canary turn against the test-fixture-gated
   store, assert durable receipt, assert legacy path frozen; fail loudly if the
   canary write ever lands without a receipt (persist-before-ack daemon contract
   means an error = no mutation committed).
4. Add `scripts/test-s18-slo-probes.ps1` and run it: fake-up/fake-down server,
   verify 2 consecutive fails emit `alert:availability`, RTO math round-trips
   the window, RPO math triggers at >5m, `-WriteVerify` passes on a live local
   daemon with fixture env set.
5. Dry-run `-RunOnce` against a locally booted daemon and record the sample
   output; no threshold is tuned in the live window.

## Success Criteria
- [ ] `scripts/s18-slo-probes.ps1 -RunOnce` against a local daemon emits one
      timestamped JSON line per probe.
- [ ] Fake-server test proves: 2 consecutive availability fails emit
      `alert:availability`; restored-ok closes the window and emits the RTO
      duration; RPO age > 5m emits `alert:rpo`.
- [ ] `-WriteVerify` returns a durable receipt for the canary turn and confirms
      legacy frozen (410/config-gated) with fixture env set.
- [ ] No `SEN_GO_BUILDER_EXEC_AUTHORITY`/`DATABASE_URL`/token-like values in any
      probe output.
- [ ] Thresholds are the ops-prep §1d values, unmodified, and armed before any
      live canary run (G4).

## Risk Assessment
Assumption: the daemon is reachable on loopback (running locally or in the S17
container).
Signal: RPO probe reads the daemon's read-back surface but the store is empty →
response: report `pending`, never PASS (OM-17); the canary write-verification is
the probe that turns empty into measured.
Signal: probe Watch loop dies and no one restarts it → response: Phase 3 wires it
into a Windows scheduled task (the one-command install next phase); alert events
stay on disk so gaps are visible as gaps, not silence.
Signal: legacy path answers 200 during write-verification → response: hard fail —
that is exactly the regression this probe exists to catch; record the alert and
do not proceed to any close.