---
title: "S15 canonical adoption and app integration"
description: "Sprint 15: make the canonical Go chat + sen-plane projections the runtime path the app actually uses, align the chat client DTO, and harden CI/backup around the adopted store."
status: pending
priority: P1
effort: ""
tags: [s15, canonical-chat, sen-plane, adoption, ui, ci]
created: 2026-09-01
---

# S15 canonical adoption and app integration

## Overview

Sprint 10-14 and Phase 12 (legacy chat cutover) are closed. The canonical Go
store (sen-plane + product.SendTurn) is live with backfilled data, but the app
only uses it when `SEN_DAEMON_URL` is set — the UI chat client still expects the
legacy receipt shape, the daemon is not part of the dev/run loop, and CI runs
npm against a pnpm project. Sprint 15 makes canonical the **default runtime
path** end-to-end.

## Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | Chat client DTO alignment + `SEN_DAEMON_URL` canonical-first runtime (spawn sen-plane in dev/run) | P1 |
| 2 | App UI surfaces consume sen-plane projections (slots, attempts, store-backed chat) | P1 |
| 3 | Ops polish: pnpm CI, daemon integration job, backup/restore drill | P2 |

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | Canonical chat runtime adoption (receipt alignment + daemon spawn + env default) | Pending |
| 2 | App surfaces for Go projections (slots/attempts/chat views) | Pending |
| 3 | CI/ops hardening (pnpm, daemon job, restore drill) | Pending |
| 4 | Close gate (independent arbiter + CLOSED_GO) | Pending |

## Success criteria

- [ ] Chat client renders canonical receipt (commandId/turnSeq/turnId/chatAttemptId/status) without adapter hacks.
- [ ] `npm run dev`-equivalent starts sen-plane + sets canonical env; legacy JSONL path is provably non-default.
- [ ] UI shows store-backed slots/attempts; chat reads/writes through the canonical store in normal operation.
- [ ] CI green on pnpm; a daemon-backed integration job runs the canonical chat round-trip.
- [ ] Restore drill verified against the pre-cutover backup; S10-S14 chains + controls intact.

## Ownership

Owns only `plans/260901-1356-s15-*`. Hard invariants: `legacy_writer:
disabled` (stays — canonical is default, nothing enables a legacy writer),
`phase_21: blocked`; no release/cutover scope here.

<!-- slug: s15-canonical-adoption-and-ui -->