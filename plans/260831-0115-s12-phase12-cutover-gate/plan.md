---
title: "Phase 12 gate: legacy cutover and retirement contract"
description: "Gate definition for release cutover and legacy-writer retirement, deferred by Sprint 10 to this separate gate. Not an authorization."
status: pending
priority: P2
effort: ""
tags: [gate, phase12, cutover, legacy-retirement]
created: 2026-08-31
---

# Phase 12 gate: legacy cutover and retirement contract

## Status

**NOT_OPEN.** This document defines the Phase 12 gate that Sprint 10 explicitly
deferred: *"Keep release cutover and legacy retirement out of scope until the
separate Phase 12 gate."* It grants no release, cutover, legacy-writer
enablement, Phase 21, deployment, or budget authority. It is a contract a
future, separately approved run must satisfy.

## Why a separate gate

Sprint 10 closed as **GO** for the S10 scope only (`05eefea`), with the loopback
operational evidence accepted as bounded. Release cutover and legacy retirement
cross the boundary from evidence-only to production mutation: they need a live
operational environment, real monitoring, a real rollback path, and release
authority. That authority was NOT granted by any S10 verdict and cannot be
granted by this inventory.

## Entry conditions (all required)

- [ ] Live, reachable staging/production-equivalent environment distinct from
      any controlled evidence checkout.
- [x] New plan + budget approved by the owner (2026-08-31; ops-prep §2, readiness record `plans/reports/s12-phase12-readiness-260831.md`).
- [ ] Active controller lease (now unblocked: `scripts/controller-failover.ps1`
      restored, `88c1dc3`; scheduled-task watchdog reinstalled and enabled).
- [ ] Inventory of the legacy canonical write surface (writer/gate paths that
      S09/S10 left `disabled`) is current-byte pinned.
- [ ] Independent pre-gate arbiter returns READY for a cutover (not S10 grading).

## Scope and non-goals

In scope: switch canonical writes from the legacy surface to the current
adapter, retire the disabled legacy writer path, update controls, record the
cutover receipt, run the post-cutover close gate.

Out of scope: S11+ feature delivery, DTO/schema migration without its own plan
and owner approval, reopening any released sprint, weakening privacy/redaction
gates, credential/capability exposure.

## Invariants (hold until Phase 12 GO is recorded and completed)

- `legacy_writer: disabled` remains true UP TO and DURING cutover; it flips to
  `enabled` only as the final atomic step, and immediately rolls back on any
  gate failure.
- `phase_21: blocked` remains until Phase 12's own approved GO.
- Cutover is atomic with an automatic rollback branch: on any verifier, test,
  monitoring, or write-verification failure, the old writer path is restored
  and the run is recorded NO_GO.
- No simulated/loopback evidence substitutes for live-verified cutover evidence.

## Evidence required at GO

- Live monitored canary and cutover drill with real SLO/RPO/RTO measurements.
- Write-verification receipt proving new adapter is canonical on the live
  environment and the legacy path is inert/retired.
- Rollback drill receipt (restore from the atomic branch) with success result.
- Security/privacy review receipt; no secrets or private content in artifacts.
- Current-byte chain: receipts, risk ledger, handoff, and an independent
  Phase 12 arbiter verdict.

## Fallback

If any entry condition, invariant, or evidence requirement is unmet: retain
`legacy_writer: disabled`, `phase_21: blocked`, record a diagnosed NO_GO, and
do not proceed. A GO requires independent arbitration against promoted bytes,
exactly as Sprint 10 did.

## Ownership

This plan owns only this document. No execution, environment, budget, or
release change is made here. Repository roots: `plans/` + `docs/` as usual.

<!-- slug: s12-phase12-cutover-gate -->