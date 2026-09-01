---
title: "S18 live SLO observability"
description: "Sprint 18: live SLO probes that are actually measured (Availability/RPO/RTO/write-verification), a local metrics store + dashboard under %LOCALAPPDATA%\\NEWSOS\\s12-metrics (no third-party), cadence automation (scheduled probe job + backup cadence enforcement), and the standard independent-arbiter close gate."
status: completed
priority: P1
effort: ""
tags: [s18, observability, slo, probes, metrics, dashboard, automation, close-gate]
created: 2026-09-01
---

# S18 live SLO observability

## Overview

The S12 ops-prep pack (`plans/260831-0206-s12-phase12-cutover-pack/ops-prep.md`)
specified live, externally verifiable SLO probes (Availability 30s poll / alert on
2 consecutive fails, RPO ≤ 5m, RTO ≤ 15m, write-verification after canary) with
metrics stored in `%LOCALAPPDATA%\NEWSOS\s12-metrics` — but never shipped the
harness. S17 packaged the product as one portable commitment; Sprint 18 delivers
the observability layer the cutover contract (gate G2/G4) depends on: probes that
are actually measured, a local append-only metric store with a no-third-party
dashboard view, cadence automation (scheduled probe job + backup-cadence
enforcement), and a close gate.

Everything is local-first, matching the S12 ops-prep "no third-party ingest"
decision: one PowerShell probe script, one small Next.js dashboard route over the
existing app, one scheduled task. No new external dependencies.

## Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | Probe harness: live Availability (healthz poll /30s, alert on 2 consecutive fails), RPO (newest durable write vs wall clock, threshold 5m), RTO (failure-signal to restored, threshold 15m), write-verification after canary — all samples timestamped | P1 |
| 2 | Metrics store + dashboard: append-only series in `%LOCALAPPDATA%\NEWSOS\s12-metrics`, one dashboard view served by the existing app route (no third-party ingest/charts) | P1 |
| 3 | Cadence/automation: scheduled probe job (Windows scheduled task mirroring `install-controller-failover-task.ps1`) + backup cadence enforcement wired into the run/docs | P1 |
| 4 | Close gate: independent fresh-session arbiter + CLOSED_GO record per S10-S16 pattern; `legacy_writer: disabled` and `phase_21: blocked` preserved; no release | P1 |

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | Probe harness — SLO probes implemented + alert thresholds | Pending |
| 2 | Metrics store + minimal dashboard | Pending |
| 3 | Cadence/automation (scheduled probe + backup cadence hook) | Pending |
| 4 | Close gate | Pending |

## Success criteria

- [ ] Probe script polls `GET /healthz` every 30s, fires an alert record on 2
      consecutive failures, computes RPO from the newest durable write in the
      canonical store (threshold 5m) and RTO from failure-signal to restored
      (threshold 15m); all samples carry RFC3339 timestamps.
- [ ] A canary write-verification probe runs after a registry canary and proves a
      durable receipt (CommandID/TurnID) returns from the canonical path while
      the legacy path stays frozen.
- [ ] Metric series are append-only under `%LOCALAPPDATA%\NEWSOS\s12-metrics`;
      one app-served dashboard route renders latest Availability/RPO/RTO/verification
      state — zero third-party ingest.
- [ ] A scheduled task runs the probe job on the cadence; backup cadence
      (nightly + pre/post-flip, `sha256sum -c` verified) is enforced/recorded in
      the runbook.
- [ ] Independent arbiter GO on committed bytes; CLOSED_GO record; `legacy_writer:
      disabled`, `phase_21: blocked`, S16/S17 chains intact; no release scope.

## Ownership

Owns only `plans/260901-1504-s18-observability/*` and the probe/metrics/dashboard
files named in the phases. No release, cutover, or Phase 21 authority; cannot
flip `legacy_writer`. Observability is read/questioning tooling; nothing here
changes runtime write semantics (canonical chat, legacy freeze, loopback binds
stay as closed in S10-S17).

<!-- slug: s18-observability -->
