# Static Gate Receipt — Phase 2

**Commit:** `3776156a51428bd2d9bdff38b2e0d3c5cd84e632`  
**Run window:** 2026-09-02 ~20:28–20:50 +07:00

## Mechanical gates

| Gate | Command | Exit | Result | Detail |
|------|---------|-----:|--------|--------|
| npm unit/integration | `npm test` | 0 | **PASS** | 58/58 pass |
| Go vet + test | `npm run go:check` | 0 | **PASS** | 15 packages ok |
| TypeScript | `npx tsc --noEmit` | 0 | **PASS** | 0 errors |
| Protected controls | `npm run protected:check` | 0 | **PASS** | `PROTECTED-CONTROLS-OK (phase_21: closed_g0, canonical writer live, legacy rollback not pre-enabled)` |
| Pester S17 | `npm run pester:runner` | 0 | **PASS** | Quiet pass |
| S22 local rehearsal | `scripts/run-s22-local-rehearsal.ps1` | 0 | **PASS** | `S22-LOCAL-REHEARSAL-PASS port=3982/3984 isolated=true` |
| Total harness (live) | `scripts/run-total-tests.ps1` | 0 | **9 PASS / 0 SKIP** | Receipt: `plans/reports/total-e2e-test-2026-09-03T053945.json` |
| Production build | `npm run build` | 0 | **PASS** | After stopping dev server + removing corrupted `.next/dev` |

## Build note (not a product defect)

First `npm run build` while `next dev` was running failed: corrupted `.next/dev/types/routes.d.ts` (`Unterminated regular expression literal`). **Recheck:** always stop dev before release build. Retry after cleanup: **PASS**.

## Live overlay (G5)

Final run: **9 PASS / 0 SKIP** — receipt `plans/reports/total-e2e-test-2026-09-03T053945.json`.

| Step | Status | Detail |
|------|--------|--------|
| live container healthz | PASS | healthz 200 on 3737 |
| live canary write+readback | PASS | canonical turn durable |
| live legacy surfaces inert | PASS | PATCH=501 DELETE=501 firstmate=410 |

Ops: recreate with `scripts/publish-s22-prod.ps1` (host port + shared `~/.agentic-os/api-token`).

## Supplementary QA (tsx, Phase 3/4 overlap)

| Suite | Tests | Result |
|-------|------:|--------|
| orca-reconcile, orca-slot-status, shell, desktop-module-registry, platform-capabilities | 40 | **PASS** |

## S10 / durability contracts (from npm test harness)

All `qa/tests/s10-*.test.ts` cases passed (registry, lane A/C, controlled delivery, phase 4 simulation, live loopback drill, offline recovery). Evidence: npm test log 58 tests.
