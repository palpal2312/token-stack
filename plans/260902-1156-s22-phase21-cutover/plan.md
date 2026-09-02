---
title: "S22 Phase-21 production cutover"
description: "The Phase-21 release gate: take canonical SEN chat live on a production host, exercise staged cutover with canary and rollback, and — on independent GO — promote CLOSED_GO with the writer authority finally enabled."
status: pending
priority: P1
effort: ""
tags: [phase21, release, cutover, production]
created: 2026-09-02
blockedBy: []
blocks: []
---

# S22 Phase-21 production cutover

## Overview

Sprint 10..21 delivered an evidence-closed, canonical Go control plane + app.
Phase-21 is the **release** gate that has remained `phase_21: blocked` by
design. This plan defines how to run a real production cutover: provision a
host, stage the cutover behind a canary, prove durability / rollback, and — on
an independent GO — record CLOSED_GO with the writer authority finally enabled.

No session, script, or CI flips `phase_21` or the writer outside this plan's
owner-recorded gate.

## Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | Live production host provisioned (Docker container or equivalent) with monitored canary | P1 |
| 2 | Staged cutover: canonical live-verified, old surfaces retired, rollback proven | P1 |
| 3 | Independent Phase-21 arbiter GO → `CLOSED_GO` + `legacy_writer: enabled` (final, recorded) | P1 |

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | Authority + preflight (owner approval ID, environment, budget, risk) | Completed |
| 2 | Provisioning and canary (host, deploy, monitored SLO) | Pending |
| 3 | Cutover + verify + rollback drill | Pending |
| 4 | Close gate: arbiter GO → CLOSED_GO → live enablement note + runbook | Pending |

## Success criteria

- [x] Preflight approval ID recorded: `P21-A01-20260902` (owner-delegated mint,
      receipt `plans/reports/s22-phase21-preflight-approval.md`); host = production
      Docker this machine; budget bounded local; guard holds; rehearsal PASS.
- [ ] Host live; canary writes durable; SLO healthz 200, RPO/RTO within threshold.
- [ ] Cutover verified (write-verification), old surface inert, rollback drill PASS.
- [ ] Independent arbiter GO → `CLOSED_GO`; document `legacy_writer: enabled`
      (final writer authority) with rollback path; legacy/phase21 flags explicitly
      transitioned via the recorded gate only.
- [ ] Invariants elsewhere unchanged (protected-controls guard continues to guard
      everything AFTER the recorded gate).

## Ownership

Owns only `plans/260902-1156-s22-phase21-cutover/`. Executes cutover ONLY with
the preflight approval ID in place. Fallback: any gate failure → rollback, NO_GO.

<!-- slug: s22-phase21-cutover -->