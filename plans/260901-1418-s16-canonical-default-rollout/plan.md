---
title: "S16 canonical default rollout"
description: "Sprint 16: make the canonical Go chat + sen-plane the DEFAULT runtime (no env opt-in), finish UI consumption, and freeze the legacy writer."
status: completed
priority: P1
effort: ""
tags: [s16, canonical, rollout, default, legacy-freeze]
created: 2026-09-01
---

# S16 canonical default rollout

## Overview

S10-15 and Phase 12 closed the legacy cutover and aligned the canonical DTO; the
canonical store is live with 69 turns (68 backfilled + canary) but only reachable
when `SEN_DAEMON_URL` is set. Sprint 16 makes canonical the **default runtime
path** (no env opt-in), finishes UI/chat canonical consumption, and freezes the
legacy FirstMate JSONL writer.

## Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | Canonical default: dev/run always start sen-plane + set canonical config; offline fallback defined | P1 |
| 2 | Full UI consumption: chat client fully on canonical receipts; agent-kanban dispatch no longer 400s in daemon mode; slots/attempts views read live server data | P1 |
| 3 | Legacy freeze: FirstMate JSONL writer read-only/inert, legacy data archive policy, second backup cycle | P2 |

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | Canonical-default runtime (daemon autostart + env default + offline fallback) | Pending |
| 2 | UI canonical consumption + dispatch fix | Pending |
| 3 | Legacy freeze + archives (read-only/inert, backup cycle 2) | Pending |
| 4 | Close gate (independent arbiter + CLOSED_GO) | Pending |

## Success criteria

- [ ] `npm run dev`-equivalent runs chat + slots entirely through sen-plane with
      no `SEN_DAEMON_URL` manual step; offline (daemon absent) fails closed with
      a clear error, never silent legacy writes.
- [ ] Chat UI fully renders canonical receipts; kanban dispatch works in daemon
      mode; slots/attempts UI show store data or explicit empty states.
- [ ] Legacy writer is inert by code (no silent JSONL append possible), archives
      policy documented, second backup cycle hash-verified.
- [ ] S10-15 chains and CLOSED_GO records intact; `legacy_writer: disabled`,
      `phase_21: blocked` preserved.

## Ownership

Owns only `plans/260901-1418-s16-*`. No release, cutover-division, Phase 21
authority. Canonical default is a runtime adoption, not a new writer.

<!-- slug: s16-canonical-default-rollout -->
