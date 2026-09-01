---
title: "S17 one-command packaging"
description: "Sprint 17: package app + sen-plane as ONE portable commitment — Docker multi-stage image, .env.example env-name surface, top-level run script (Windows + container), CI container smoke reusing go:check, restore cadence doc."
status: completed
priority: P1
effort: ""
tags: [s17, packaging, docker, ci, run-script]
created: 2026-09-01
---

# S17 one-command packaging

## Overview

S16 made the canonical Go chat the default runtime. Running it still requires a
hand-built Go binary plus a Node app started separately (`dev:canonical` +
`dev:next`/`start`). Sprint 17 turns the whole product into **one portable
commitment**: a single container image that boots the app and sen-plane
together, and a top-level run script that boots them natively on Windows with
zero manual steps. One artifact, one command, documented.

## Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | Container runtime packaging: multi-stage Dockerfile (go build + `next build` in one image), `.dockerignore`, loopback defaults preserved | P1 |
| 2 | Environment + run harness: `.env.example` with env NAMES only, top-level run script (Windows native + container mode), README quickstart, restore cadence doc | P1 |
| 3 | Verify + CI: container smoke when runners allow, local-equivalent smoke documented, `go:check` reused (not duplicated) | P1 |
| 4 | Close gate: independent arbiter + CLOSED_GO per S10-S16 pattern | P1 |

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | Container/runtime packaging | Pending |
| 2 | Environment and run harness | Pending |
| 3 | Verify + CI | Pending |
| 4 | Close gate | Pending |

## Success criteria

- [ ] `docker build` produces one image; `docker run -p 3737:3737` boots app +
      sen-plane; chat round-trip works through the container.
- [ ] `.env.example` lists only env NAMES (no values); `run.ps1` boots the whole
      product on Windows natively and via `-Container`.
- [ ] CI runs the container smoke when its runner allows, with the identical
      smoke documented for native runs; the Go checks come from the one
      `go:check` definition, not a duplicate.
- [ ] S16 chain, CLOSED_GO records intact; `legacy_writer: disabled`,
      `phase_21: blocked` preserved; no release scope.

## Ownership

Owns only `plans/260901-1451-s17-*`. No release, cutover-division, Phase 21
authority. Packaging changes nothing about runtime semantics: loopback defaults,
canonical chat, legacy freeze all stay as closed in S10-S16.

<!-- slug: s17-packaging -->
