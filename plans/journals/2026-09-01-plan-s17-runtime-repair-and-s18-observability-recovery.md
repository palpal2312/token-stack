---
title: Plan S17 runtime repair and S18 observability recovery
date: 2026-09-01
summary: Created a bounded repair plan from fresh roadmap-review evidence.
---

# Plan S17 runtime repair and S18 observability recovery

﻿## What happened
A fresh independent review of the S10-S19 plus Phase 12 roadmap found two executable blockers: `scripts/run-s17.ps1` resolves the parent directory instead of the repository root, and the S18 probe self-check reports `healthz 000` while no managed daemon is present.

## Decision
Created a repair-only four-phase plan. It preserves `legacy_writer: disabled`, `phase_21: blocked`, no release/cutover/flip, and forbids permanent service or scheduled-task changes.

## Next steps
Execute the plan sequentially: baseline process ownership, repair and test the runner, prove S18 against an isolated local daemon, then obtain a fresh independent review.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
