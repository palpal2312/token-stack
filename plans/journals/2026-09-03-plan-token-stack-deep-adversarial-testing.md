---
title: Plan Token-Stack deep adversarial testing
date: 2026-09-03
summary: Created and red-team validated an eight-phase deep Token-Stack QA plan.
---

# Plan Token-Stack deep adversarial testing

﻿## What happened

Created and validated a new eight-phase deep adversarial testing plan for Token-Stack, building on the completed 19-test baseline. Repository research covered core CJS contracts, PowerShell lifecycle, installers, verifier protocol, compatibility, performance, and CI.

## Decisions

- Offline tests stay temp-root and loopback only.
- Node 24 + Windows PowerShell 5.1 remain the evidenced baseline.
- Use node:test + fast-check; schedule Stryker; keep Jazzer optional.
- Live certification is manual and capped at two calls, ten output tokens, eight input tokens, and USD 0.02.
- The pending Sub2API gateway remains out of scope.

## Review

Red-team blockers were resolved: both installers gain named failpoint coverage, critical invariant gates are explicit, performance formulas are executable, and live cost/request limits are fixed. Final plan validation passed with an acyclic dependency graph.

## Next

Review plans/260903-1959-token-stack-deep-adversarial-test-program/plan.md, then execute from Phase 1 if approved.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
