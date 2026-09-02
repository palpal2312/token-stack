---
title: "S20 checklist settlement"
description: "Sprint 20: settle every unchecked plan checklist item — evidence-backed tick-sweep (files-only) for ~103 done items, implement the ~21 real gaps, then close gate."
status: pending
priority: P1
effort: ""
tags: [s20, checklist, settlement, cleanup, close]
created: 2026-09-02
---

# S20 checklist settlement

## Overview

The S10..S19 + Phase 12 plans are closed by independent CLOSED_GO, but 124
checklist items were never ticked. Audit (`plans/reports/checklist-audit-260902-s10-s19.md`)
classified ~103 as DONE-evidence (bookkeeping) and ~21 as real OPEN gaps. S20
settles both: a files-only tick sweep (no authority change) for the done set,
and implementation of the real gaps, then a standard close gate.

## Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | Tick-sweep: mark DONE-evidence items with their CLOSED_GO/verdict reference; update phase statuses consistently | P1 |
| 2 | Implement OPEN gaps (S17 run.ps1 root + native smoke receipt + container CI exec path; S18 probe RunOnce/WriteVerify/fake-server/rotation/cadence script; S15 canonical default real + pnpm decision; S16 empty-state UI verify; approvals named; P12 lease note) | P1 |
| 3 | Full regression (suites/go/tsc/chains/controls) and close gate | P1 |

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | Tick-sweep (files-only, evidence-linked) | Pending |
| 2 | Implement OPEN gaps | Pending |
| 3 | Regression + verification | Pending |
| 4 | Close gate (independent arbiter + CLOSED_GO) | Pending |

## Success criteria

- [x] Zero unchecked items without an evidence link or an explicit OPEN resolution.
- [x] OPEN gaps closed or explicitly marked owner-gated/external (Docker exec, production flips).
- [x] Suites/go/tsc/chains clean; controls `legacy_writer: disabled`, `phase_21: blocked`.
- [x] Independent arbiter GO; CLOSED_GO + journal; no release authority.

## Ownership

Owns only `plans/260902-0154-s20-*` plus the checklist files it settles. No
release/cutover/flip authority.

<!-- slug: s20-checklist-settlement -->