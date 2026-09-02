---
title: Version acceptance execution — ACCEPTED_WITH_BLOCKERS
date: 2026-09-02
summary: "Five-phase acceptance run on commit 3776156; mechanical gates pass; five documented gaps block clean release."
severity: High
component: release-acceptance
status: Resolved
---

# Version acceptance execution — ACCEPTED_WITH_BLOCKERS

**Date**: 2026-09-02 21:00  
**Commit**: `3776156a51428bd2d9bdff38b2e0d3c5cd84e632`  
**Plan**: `plans/260902-1818-nghim-thu-cc-chc-nng-hin-c-ca-phin-bn/`

## What Happened

Completed all five acceptance phases (baseline → static gates → surface UAT → agent/durability → security verdict). Mechanical gates, core navigation, Sen, orchestration, kanban, goals UI, memory, and 40/40 Orca QA tests **pass**. Release disposition: **ACCEPTED_WITH_BLOCKERS** — not a clean ship.

Receipts: `plans/260902-1818-.../reports/acceptance-verdict.md` and sibling reports under `reports/`.

## The Brutal Truth

We almost shipped a false sense of completeness. README promises a journal page that does not exist. A security probe on goals GET returned vault data with a foreign Host header. Settings renders but is preview-only. Dify and live-container paths were never exercised. Calling any of these PASS would be lying to the next person on call.

**Journal capability is FAIL** — route gap, not environment blocker. Do not mark it PASS in the capability matrix.

## Technical Details — Mandatory Gaps

| ID | Finding | Disposition |
|----|---------|-------------|
| G1 | `GET /journal` → **404**; no `src/app/journal/page.tsx`; README L26 claims journal UI | **FAIL** |
| G2 | `GET /api/goals` accepts `Host: evil.example.com` → 200; POST/PATCH/DELETE guarded, GET is not (`route.ts:23-28`) | **FAIL** |
| G3 | Settings: empty snapshot, no write POST, fixture gated by `AGENTIC_OS_ALLOW_TEST_FIXTURE` | **NOT-PRODUCTION** |
| G4 | Dify namespace exists; connections 401 without token; no run/handoff/materialize drill | **BLOCKED** |
| G5 | Live container E2E: 3 steps skipped (`total-e2e-test-2026-09-02T203029.json`) | **SKIP** |
| G6 | Docs/product mismatch — README lists journal; route absent from 62-page inventory | **FAIL** (docs) |

## What Passed (context)

Static gates (tsc, pester, protected:check), S22 durability rehearsal, S10 suite (58 tests), production build, sen/orchestration/goals/memory/diffy UI shells, Dify unauthenticated → 401.

## Root Cause Analysis

Acceptance plan was sound; execution surfaced **pre-existing product debt**, not test harness failure. Journal was documented in README and nav grouping but never implemented. Goals GET guard was an inconsistent application of `checkLocalRequest` across HTTP methods. Dify/container gaps are credential/environment dependencies left explicitly unproven.

## Decisions

- **Verdict vocabulary**: ACCEPTED_WITH_BLOCKERS — blockers are explicit FAIL/BLOCKED/SKIP entries, not waived.
- **Journal**: recorded as FAIL (G1/G6); README or route must change before claiming journal surface.
- **Goals GET**: security FAIL until guard added or ADR + tests document intentional public read.
- **Settings**: treat as preview until Go config write path ships.

## Lessons Learned

1. README/route inventory drift is a release blocker when acceptance is evidence-based.
2. Partial `checkLocalRequest` coverage on one resource is worse than none — it signals false safety.
3. BLOCKED/SKIP must stay visible in verdict; environment gaps are not PASS by omission.

## Next Steps

| Priority | Action | Owner |
|----------|--------|-------|
| P1 | Ship `/journal` page **or** remove README/nav claims | Product |
| P1 | Add GET guard on `/api/goals` or ADR + tests | Security |
| P2 | Rerun `scripts/run-total-tests.ps1` without `-SkipLive` when Docker ready | Ops |
| P2 | Dify UAT with token + connection fixture | Integrations |
| P3 | Document settings as preview-only | Docs |

> Historical work record — not durable authority. Prefer `plans/.../reports/acceptance-verdict.md` for gap register.
