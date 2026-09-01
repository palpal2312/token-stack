---
phase: 2
title: "Environment and run harness"
status: pending
priority: P1
effort: ""
dependencies: [1]
---

# Phase 2: Environment and run harness

## Overview
Document the full configuration surface and give the product one top-level run
command. `.env.example` lists only env NAMES (no values), so the surface is
discoverable without pinning local defaults. `run.ps1` boots the whole product
natively on Windows or, with `-Container`, via Docker. README quickstart and a
restore-cadence doc close the "how do I run this" and "how do I restore a
backup" gaps.

## Requirements
- Functional: `.\run.ps1` boots app + sen-plane with `npm start` semantics;
  `.\run.ps1 -Container` builds and runs the Phase 1 image; README quickstart
  covers both.
- Non-functional:
  - `.env.example` rows are bare env NAMES only — no values, no real defaults
    (the repo already has those in code) — so it never drifts into a secrets/
    config file.
  - The run script is a thin wrapper: reuse `scripts/dev-sen-plane.ps1` patterns
    (build-then-wait, loopback address) and `npm` scripts; no duplicated logic.
  - Restore cadence doc follows the S16 evidence-verified backup lesson
    (`sha256sum -c` from the manifest's own root, cycles kept outside git).

## Architecture
- `run.ps1` (repo root), two modes:
  - default (Windows native): build sen-plane to `go/bin/` (same as
    `dev-sen-plane.ps1`), start it on `127.0.0.1:3979` with the real store, then
    `npm start`; on exit, stop the daemon. Equivalent to `dev:canonical` +
    `start` in one command.
  - `-Container`: `docker build` then `docker run -p 3737:3737`, printing the
    dashboard URL; maps no volumes by default (state stays inside the
    container; persistent-store image is explicitly out of scope this sprint).
- `.env.example`: one bare `NAME=` line per env read by the app + daemon:
  `AGENTIC_OS_HOST`, `AGENTIC_OS_PORT`, `PORT`, `AGENTIC_OS_NEXT_DIST_DIR`,
  `SEN_PLANE_ADDR`, `SEN_PLANE_STORE_DIR`, `SEN_DAEMON_URL`,
  `SEN_CHAT_LEGACY_WRITER`, `AGENTIC_OS_ALLOW_TEST_FIXTURE`.

## Related Code Files
- Add: `.env.example`, `run.ps1` (repo root),
  `docs/backup-restore-cadence.md`.
- Modify: `README.md` (quickstart section).
- Read: `scripts/dev-sen-plane.ps1` (build/wait/env-restore pattern),
  `package.json`, `server.ts`, `go/cmd/sen-plane`.

## Implementation Steps
1. Add `.env.example` with the bare names listed in Architecture.
2. Add `run.ps1` with the two modes; `-Container` delegates to the Phase 1
   Dockerfile, native mode reuses the `dev-sen-plane.ps1` build/launch pattern.
3. Add the README quickstart: prereqs (Node 24, Go 1.26, or Docker), two run
   commands, where the store lives, how env names are set.
4. Add `docs/backup-restore-cadence.md`: backup the sen-plane store on a stated
   cadence, verify each cycle with `sha256sum -c` from the manifest root, keep
   cycles outside git, and document the restore step (stop app, replace store
   dir from latest verified cycle, restart). Call out the S16 lesson that
   offline never writes silently.

## Success Criteria
- [x] `.env.example` exists with env names only and no values. (_evidence: see CLOSED_GO record)
- [x] `.\run.ps1` on Windows boots app + daemon; chat writes to the canonical (_evidence: see CLOSED_GO record)      store; Ctrl+C / exit stops the daemon.
- [x] `.\run.ps1 -Container` boots the same product via Phase 1 image. (_evidence: see CLOSED_GO record)
- [x] README quickstart and `docs/backup-restore-cadence.md` present and (_evidence: see CLOSED_GO record)      accurate against the actual scripts.

## Risk Assessment
Assumption: a Windows-native single wrapper can supersede the two-step
`dev:canonical` + `start` without breaking existing script users — response:
`run.ps1` only wraps the existing npm scripts, `dev-sen-plane.ps1` and
`dev:canonical` stay untouched.
Risk: `run.ps1` leaves an orphan daemon on early exit — response: trap/finally
kills the tracked PID; verify with a smoke run.