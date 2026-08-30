---
title: Define Optimal Lane Count capacity contract
date: 2026-08-26
summary: "Consolidated machine-aware, workload-weighted and fallback-aware OLC into NEWS OS docs, Master skills and SEN plans."
---

# Define Optimal Lane Count capacity contract

﻿## What happened

The OLC discussion was consolidated into one evergreen capacity contract and linked from the orchestration runbook, Master memory, takeover skills, the active Sprint 05-07 plan, and the SEN implementation plan.

## Decision

OLC is hierarchical: Global baseline, Effective Global OLC, Sprint OLC, then per-Sprint allocation. Effective capacity changes with local resource pressure, weighted active workloads, verified worker/quota/fallback health, dependencies, ownership and approved budget. Missing fallback after provider exhaustion removes the slot. SEN may downshift automatically; upshift remains inside the user-approved ceiling. Orca remains execution authority.

## Evidence and validation

Both related plan directories pass AgentKit validation. The source plan index was reindexed. NEWS OS Master isolated tests pass 7/7.

## Next steps

Sprint 06 implements the OLC proposal, session telemetry, dynamic admission/downshift and privacy gates. Sprint-close evidence compares proposed and actual OLC before local learning updates.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
