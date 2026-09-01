---
title: "S14 CI and dev-loop hardening"
description: "Sprint 14: wire a runnable local QA harness, a dev-loop starter for sen-plane, and a CI workflow; close with the standard arbiter gate."
status: completed
priority: P1
tags: [s14, ci, dev-loop, qa]
created: 2026-09-01
---

# S14 CI and dev-loop hardening

Overview: the repo has suites with no npm/CI run wiring and a Go daemon that no
dev script starts. S14 adds: a root `test:all` harness (shell+parser+s10+go),
a dev-loop starter for `cmd/sen-plane`, a GitHub Actions CI workflow
(test+go+tsc), then closes via the standard independent-arbiter + CLOSED_GO.

Phases
1. QA harness: package.json `test:all` (tsx --test shell+parser+s10) + `go:check` (compile/vet/test).
2. Dev-loop: `scripts/dev-sen-plane.ps1` (compile+start sen-plane against a dev store root) + README note.
3. CI: `.github/workflows/ci.yml` (node+go matrix, run harness, tsc).
4. Close gate: independent arbiter GO -> CLOSED_GO -> journal.

Invariants: legacy_writer disabled, phase_21 blocked, no release/cutover.

Success: `npm run test:all` + `npm run go:check` green; dev-loop starts daemon and
probes /healthz; CI file present; arbiter GO recorded.
<!-- slug: s14-ci-and-devloop -->
