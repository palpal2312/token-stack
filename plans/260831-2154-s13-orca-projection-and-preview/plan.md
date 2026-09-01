---
title: "S13 orca projection and preview"
description: "Wire the real orca-store projection into cmd/sen-plane, enable desktop-shell preview on a staging seat under the 1809 gate, close the recorded debt pass, and close the sprint under an independent gate."
status: completed
priority: P1
effort: ""
tags: [s13, go-plane, orca, projection, desktop-shell, debt]
created: 2026-08-31
---

# S13 orca projection and preview

## Overview

Sprint 12 closed as **GO** (`s12-CLOSED_GO-record.md`): `cmd/sen-plane` serves the
full proxy surface but the slot source is a memory seed and attempts/codespace
are valid-empty. Sprint 13 replaces the seed with the real `internal/orca` store
projection (`slots/attempts` become live-backed), enables the desktop-shell v2
flag as a **staging-seat preview only** under the 1809 enable-gate, closes the
recorded type/coverage/dev-loop debt, and closes under the S10-S12 independent
arbiter pattern. Invariants hold throughout: `legacy_writer: disabled`,
`phase_21: blocked`, **no release or cutover in S13** — Phase 12 remains the
owner-gated cutover and the production desktop-shell flip remains a separate
owner-approved deploy.

## Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | Real orca projection in `cmd/sen-plane`: drop the memory `SlotSource` seed; `slots`/`attempts` served from `internal/orca` store + `internal/reconcile`; current-byte receipt | P1 |
| 2 | Desktop-shell v2 preview on one staging seat via the 1809 gate (env flip, SLO probes, rollback drill, enable receipt); production flip stays owner-approved and out of scope | P1 |
| 3 | Debt pass: full-project `tsc` baseline to zero; web read-path node:test suites (query cache / reconciler / go-builder-exec-client); `sen-plane` into the dev loop; container/dev-entry wiring | P2 |
| 4 | Close gate on committed bytes (independent arbiter, CLOSED_GO record, journal events), S10-S12 pattern | P1 |

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | Orca projection wiring (live slots/attempts, migrations, receipt) | Pending |
| 2 | Desktop-shell preview enablement on a staging seat (1809 gate) | Pending |
| 3 | Debt pass (tsc zero, web read-path suites, dev-loop daemon, container wiring) | Pending |
| 4 | Close gate + handoff (independent arbiter, CLOSED_GO, journal) | Pending |

## Implementation steps (working notes under this dir as each phase opens)

### Phase 1 — orca projection wiring

1. Replace `memorySlotSource` in `go/cmd/sen-plane/main.go` with a source
   backed by `internal/orca.Store`. `orca.Open(ctx, root)` already runs
   `core.Migrate` with the orca migrations and `IntegrityCheck`; the slot DTO
   the daemon hand-rolls (`SlotDTO`/`RuntimeSlotsDTO`) already exists as
   `orca.Slot`/`orca.RuntimeSlots` — consume those instead of duplicating the
   wire shape. Migration byte-identity is already enforced by
   `internal/orca/schema_test.go` against `go/migrations/000004_orca_dispatch_cursors.sql`.
2. Give the daemon a data root (env, e.g. `SEN_PLANE_DATA_ROOT`, default a
   local `data/` dir) so the store opens on a real on-disk db. Keep loopback
   bind, `/healthz`, and safe-field DTO rules intact.
3. Live-back `GET /api/v1/runtime/slots` from the store (dispatch/active rows
   → slot state) joined through `internal/reconcile.ProjectSlots` (read-only,
   fails closed), preserving the exact fields `parseRuntimeSlots` expects.
4. Live-back `GET /api/v1/runtime/attempts`: map active/terminal orca dispatch
   rows (`StatusDispatched`/`StatusRunning`/terminal statuses) to the
   `RuntimeAttemptDTO` fields the `GoRuntimeAttempt` validator parses
   (`attempt_id`, `task_id`, `builder_id`, `pane_id`, `status`,
   `lease_generation`, timestamps). `last_heartbeat_at` from the output-cursor
   row where present.
5. `GET /api/v1/codespace/summary`: no Go codespace store exists — keep the
   v1 empty envelope and say so in the receipt; a codespace store is a
   future phase, not a goal here.
   `ponytail:` execution-preference stays reflect-only (`accepted-no-durable-store`)
   unless a durable preferences store lands in this sprint — not a goal.
6. Prove and record: `go test ./...` + `go vet ./...` green, `go build ./...`
   green, then run the daemon against a fresh data root and round-trip ALL real
   TS clients with `SEN_DAEMON_URL` (S12 pattern): `readRuntimeSlots`,
   `readRuntimeProjection`, `readCodeSpaceSummary`. Write the receipt under
   `plans/reports/s13-phase1-orca-projection-260831.md` noting commit SHA, the
   migration applied, and the live round-trip rows (slots non-seed, attempts
   real). Receipt is evidence, not a result — phases re-run checks against
   current bytes.

### Phase 2 — desktop-shell preview enablement (staging seat)

Per the 1809 gate (`plans/260831-1809-s12-desktop-shell-enable-gate/plan.md`).
This phase enables a **staging seat only**; the production flip remains a
separate owner-approved deploy outside S13.

1. Gate inputs before the flip: `next build` green at the chosen commit
   (S11 smoke basis); S12 shell node:test suites present and passing;
   owner approval recorded (named approver + date).
2. Env-only flip: `DESKTOP_SHELL_V2=1` on the staging host only — never via
   query/view (`src/shell/desktop-shell-flag.ts`; request-time in
   `src/app/layout.tsx`). All other environments keep the flag off; repo
   default stays OFF.
3. Smoke: flag OFF = legacy surface, flag ON = shell surface, both 200, on
   the staging host (not a controlled checkout). Verified via the
   discriminating `/settings` route (S11 lesson).
4. Observe under real traffic: shell's `navigation-progress`/`view-session`/
   panel stores with SLO probes (phase-12 ops-prep pattern). No demo fixture
   data unless `AGENTIC_OS_ALLOW_TEST_FIXTURE=1` + `NODE_ENV!==production`.
5. Rollback drill: unset the env (or set `0`), verify legacy surface
   byte-equivalence immediately (flag is request-time checked).
6. After N stable hours (N pinned at enable time), record the enable receipt
   `plans/reports/s13-desktop-shell-enable-receipt.md` (env state, smoke
   bytes, metrics window, rollback drill, owner approval). Note explicitly:
   enabling the preview does NOT touch `legacy_writer` or `phase_21`.

### Phase 3 — debt pass

1. Type baseline: full-project typecheck (`npx tsc --noEmit` on `tsconfig.json`)
   to **zero reported errors**; fix in place (the `.orig` files and `qa-*.log`
   clutter under repo root are candidates for cleanup once green).
2. Web read-path node:test suites, one per module, mutation-catching and
   minimal (S12 test-sweep pattern), written against real exports and run
   before merge:
   - `src/lib/query/query-cache.ts`
   - `src/lib/query/realtime-reconciler.ts`
   - `src/lib/agentRuntime/go-builder-exec-client.ts` (read-path parsers/
     validators; existing parity/rollback suites cover behaviour, add the
     validator/parse surface)
3. Daemon into the dev-loop: today nothing spawns `sen-plane` in `server.ts`,
   so dev requires a manual export. Add a run-script path that builds+runs the
   daemon alongside `npm run dev` (`dev` / a `dev:plane` script) so the loop is
   one command and `SEN_DAEMON_URL` is set for the app by default.
   `ponytail:` keep it a thin wrapper script over the existing daemon — no new
   supervisor unless one is already present.
4. Container/dev-entry wiring: no `Dockerfile` or container dir exists in the
   repo today — define the minimum dev-entry that boots `next` + `sen-plane`
   (db root mounted/volume) and validate a `next build` + `next start` +
   daemon container path. This is net-new and minimal; do not extend beyond
   the dev loop the container must serve.

### Phase 4 — close gate

1. On committed evidence, run the S13 close-gate arbiter as an independent
   fresh session (S10/S11/S12 pattern): re-execute the owned checks against
   current bytes — controls (`legacy_writer: disabled`, `phase_21: blocked`, 0
   `enabled` hits, `DESKTOP_SHELL_V2` OFF by default in repo), `tsc` zero,
   node:test suites, `go test`/`go vet`, and the Phase 1/2 receipts.
2. On GO: record `plans/reports/s13-CLOSED_GO-record.md` (arbiter verdict
   SHA-256, master commit, scope = S13 only), emit journal lifecycle events,
   and update `docs/newsos-master-memory.md` S13 checkpoint. Finalize remains
   gated by the controller-failover state machine (disabled watchdog; reinstall
   on the live host before Phase 12).

## Success criteria

- [x] `cmd/sen-plane` serves `slots`/`attempts` from the real `internal/orca` (_evidence: see CLOSED_GO record)      store (memory seed gone); `go test`/`go vet` green; migration applied on a
      fresh data root; current-byte receipt records a live round-trip of all
      proxy clients. `codespace/summary` stays valid-empty with the reason noted.
- [x] Desktop-shell v2 preview enabled on ONE staging seat via env flip with (_evidence: see CLOSED_GO record)      smoke (ON/OFF both 200), SLO probe window, rollback drill, and enable
      receipt; repo default and all other environments remain OFF; production
      flip not performed.
- [x] Full-project `tsc --noEmit` at zero errors; read-path node:test suites (_evidence: see CLOSED_GO record)      for query-cache, realtime-reconciler, and go-builder-exec-client land and
      pass; `sen-plane` runs inside the dev loop on one command; container/
      dev-entry wiring exercised.
- [x] S13 close gate records GO or explicit NO_GO on committed bytes, with (_evidence: see CLOSED_GO record)      journal events and memory update; `legacy_writer: disabled`,
      `phase_21: blocked`, no release/cutover, Phase 12 untouched.

## Ownership

This plan owns only `plans/260831-2154-s13-orca-projection-and-preview/`.
Phase 12 cutover, legacy retirement, and the production desktop-shell flip
remain out of scope and un-owned here (owner-approved gates).

<!-- slug: s13-orca-projection-and-preview -->
