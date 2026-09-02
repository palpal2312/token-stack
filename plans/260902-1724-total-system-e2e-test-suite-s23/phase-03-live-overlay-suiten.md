---
title: "Phase 3: Live overlay + suite wiring"
status: completed
priority: P1
dependencies: [2]
---

# Phase 3: Live overlay + suite wiring

## Overview

Wire the live production-container overlay (healthz → canary write+readback →
legacy surfaces inert) so it is honest: it runs only when the container is
actually there, asserts real HTTP statuses, and degrades to SKIP cleanly. Also
wire the pester + go + tsc + guard + rehearsal steps so the whole is one
repeatable command.

## Requirements

- Functional: live steps assert status 200 / canonical readback / 501 + 410 for
  inert surfaces; `-SkipLive` short-circuits them as SKIP (not FAIL).
- Non-functional: reuse existing suites (`npm:test`, `npm:go:check`,
  `npx tsc --noEmit`, `npm:protected:check`, `npm:pester:runner`,
  `run-s22-local-rehearsal.ps1`) — never re-implement them.

## Related Code Files

- Modify: `scripts/run-total-tests.ps1`
- Use: existing `scripts/tests/*.Tests.ps1`, `scripts/run-s22-local-rehearsal.ps1`

## Implementation Steps

1. Live healthz step: poll `/api/orchestration/state` on 3737, assert 200.
2. Canary step: POST `/api/sen/chat` with `x-agentic-os-token` (null-guarded
   helper) → assert 200 + canonical ids; GET readback → assert canonical + ≥1 turn.
3. Inert step: SEN PATCH/DELETE → 501; firstmate POST → 410.
4. Wire `-SkipLive` to convert steps 1–3 to SKIP with reason.

## Todo

- [x] Live overlay wired + asserted.
- [x] Explicit and automatic SKIP paths verified; live assertions are enabled only for a host-reachable container.

## Success Criteria

- Live overlay passes on the real container; SKIP path removes the container steps
  without a false FAIL; receipt lists per-step status including SKIP.
