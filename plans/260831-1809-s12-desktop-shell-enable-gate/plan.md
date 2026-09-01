---
title: "S12 desktop-shell deploy-enablement gate"
description: "Deploy-gated enablement of the desktop_shell_v2 surface (Phase 19a desktop shell), distinct from the Phase 12 legacy cutover."
status: completed
priority: P2
created: 2026-08-31
---

# S12 desktop-shell deploy-enablement gate

## Status

**PLAN ONLY — NOT AUTHORIZING A FLIP.** The `desktop_shell_v2` surface stays
OFF by default everywhere. This gate defines how it may be enabled in a
deployment, independently of the Phase 12 legacy-writer cutover.

## Gate inputs (all required before any enable)

- [ ] Production build green (the `next build` smoke from S11 phase 3 is the basis; re-run at the chosen commit).
- [ ] Shell/web node:test coverage for the flagged modules present and passing (S12 phase 2 sweep).
- [ ] Live smoke evidence on the target environment: flag OFF = legacy surface; flag ON = shell surface, both 200, on the deployment host (not a controlled checkout).
- [ ] Owner approval recorded for the enable (named approver + date in the receipt).

## Enablement mechanics

1. Env-only flip: set `DESKTOP_SHELL_V2=1` server-side on the deployment host;
   never via query/view. All other consumers (tests, local dev) may keep it off.
2. Small rollout: enable on one staging seat first, observe the shell's
   `navigation-progress`/`view-session`/panel stores under real traffic, watch the
   metrics (SLO probes as in the phase-12 ops-prep pattern).
3. Rollback: unset the env (or flip to `0`) — the flag is request-time checked,
   so rollback is a single env change with immediate effect; verify legacy
   surface byte-equivalence on rollback.
4. After N stable hours (N pinned at enable time), record the enable receipt.

## Receipts produced on enable

- `plans/reports/s12-desktop-shell-enable-receipt.md` (env state, smoke bytes,
  metrics window, rollback drill, owner approval).
- Explicit note: enabling the desktop shell does NOT touch `legacy_writer` or
  `phase_21`; Phase 12 remains separately gated.

## Constraints

`legacy_writer: disabled`, `phase_21: blocked` hold through this gate. No
canary publishes private content; no secrets in receipts.

JOB_DONE: definition — enablement is a future owner-approved deploy action.
