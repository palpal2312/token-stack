---
title: "S19 desktop-shell rollout"
description: "Sprint 19: enable the desktop_shell_v2 surface per the 1809 enable-gate on this host, with rollback and evidence."
status: completed
priority: P1
tags: [s19, desktop-shell, rollout, enable-gate]
created: 2026-09-01
---

# S19 desktop-shell rollout

Enable desktop shell v2 (env DESKTOP_SHELL_V2=1, request-time) per
plans/260831-1809-s12-desktop-shell-enable-gate/plan.md: app renders the shell
surface; OFF stays legacy. Rollout on this host only; rollback = unset env.

Phases
1. Rollout switch: run harness `-Shell` sets DESKTOP_SHELL_V2=1 for the app process.
2. Evidence: OFF legacy vs ON shell assertions (flag test + S11/S13 probes) + rollout receipt.
3. Rollback drill: unset env, confirm legacy byte-equivalent.
4. Close gate: independent arbiter GO -> CLOSED_GO -> journal.

Invariants: legacy_writer disabled, phase_21 blocked (SEN chat unaffected by the
shell flag). No release outside this host.

Success: switch works, receipt recorded, rollback proven, arbiter GO.

- Approved: palpal2312 (owner), 2026-09-01, host-local S19 desktop-shell rollout.
<!-- slug: s19-shell-rollout -->
