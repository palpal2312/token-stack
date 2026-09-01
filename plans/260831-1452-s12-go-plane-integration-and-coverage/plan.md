---
title: "S12 Go control-plane integration and coverage"
description: "Sprint 12: wire the merged Go control-plane into the app runtime, close the shell/web test-coverage debt, and prepare desktop-shell enablement as a deploy-gated surface."
status: completed
priority: P1
effort: ""
tags: [s12, go-plane, coverage, desktop-shell]
created: 2026-08-31
---

# S12 Go control-plane integration and coverage

## Overview

Sprint 11 closed as **GO** (`s11-CLOSED_GO-record.md`, master `95f375b`): the
rewrite-baseline merged (Go control plane, desktop-shell v2 flag, web refactor)
and the desktop-shell slice passed a production-build smoke. Sprint 12 turns the
merged-but-wired-only Go packages into a real runtime path, closes the recorded
test-coverage gap, and prepares the desktop-shell flag for a deploy-gated
enablement. Release/cutover of the legacy writer stays under the Phase 12 gate
(owner-approved); `legacy_writer: disabled`, `phase_21: blocked` remain hard
invariants.

## Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | Wire the Go control-plane into the app runtime (sen-daemon or equivalent daemon serving `/api/…` the frontend already proxies to; one real invocation path end-to-end) | P1 |
| 2 | Close shell/web node:test coverage debt; cut speculative Go API with no consumer | P1 |
| 3 | Desktop-shell enablement plan + deploy gate (flag-flip rollout, monitoring, rollback) | P2 |

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | Go-plane runtime wiring (daemon + one vertical path) | Pending |
| 2 | Coverage debt sweep (shell/web suites; speculative API removal) | Pending |
| 3 | Desktop-shell deploy-enablement gate | Pending |
| 4 | Close gate + handoff (independent arbiter, S10/S11 pattern) | Pending |

## Implementation steps (phase working notes under this dir as each phase opens)

1. Choose the wiring target: run one Go binary (e.g. `cmd/` daemon or a Go server
   subcommand) that serves the surface the merged `src/app/api/*` proxies already
   expect; prove one vertical path (e.g. `herdr/slots` or `sen/scheduler/forecast`)
   roundtrip through the proxy to Go and back.
2. Add node:test suites for the shell store/controllers and web read-path modules
   that claim coverage; remove or gate speculative Go types with no consumer.
3. Author the desktop-shell enablement gate: rollout plan, metrics, rollback, and
   the deploy approval flow — independent of Phase 12.
4. Run the S12 close-gate arbiter on committed evidence; record GO or NO_GO.

## Success criteria

- [ ] One Go control-plane binary runs and serves a real proxy path end-to-end
      with an evidence receipt; Go tests stay green.
- [ ] Shell/web node:test coverage closed for the flagged modules; no
      zero-consumer speculative API remains.
- [ ] Desktop-shell enablement gate document exists; flag stays OFF by default
      until a deploy approval records the flip.
- [ ] S12 close gate (independent arbiter) records GO or explicit NO_GO;
      `legacy_writer: disabled`, `phase_21: blocked`, no release/cutover.

## Ownership

This plan owns only `plans/260831-1452-s12-*`. Phase 12 cutover and legacy
retirement remain out of scope and un-owned here (owner-approved gate).

<!-- slug: s12-go-plane-integration-and-coverage -->
