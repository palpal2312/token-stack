---
title: "Token-Stack 3.0 Expansion: 12-Layer Master Architecture"
description: "Expand Token-Stack with 5 new orthogonal layers: Turn Folding, Loop Breaker & Waterfall Failover, CoT Budget Governor, Semantic Cache, and Model Cascading Router."
status: completed
priority: P1
effort: 8h
branch: main
tags: [token-stack, architecture, turn-folding, guardrails, semantic-cache, model-router, cot-governor]
created: 2026-09-03
---

# Token-Stack 3.0: 12-Layer Master Engine Implementation Plan

Expanding Token-Stack to achieve end-to-end token and cost optimization across 100% of the AI coding task lifecycle.

## Phases & Execution Roadmap

| Phase | Description | Status | Est. Effort | Details Link |
|:---|:---|:---:|:---:|:---|
| **Phase 01** | Dynamic In-Flight Turn Folding (Historical Context Compactor) | completed | 2.0h | [phase-01-dynamic-in-flight-turn-folding.md](file:///C:/Users/ADMIN/Documents/token-stack/plans/260903-0110-token-stack-3.0-expansion/phase-01-dynamic-in-flight-turn-folding.md) |
| **Phase 02** | Runaway Loop Breaker & Smart Waterfall Failover | completed | 1.5h | [phase-02-runaway-loop-breaker-and-guardrails.md](file:///C:/Users/ADMIN/Documents/token-stack/plans/260903-0110-token-stack-3.0-expansion/phase-02-runaway-loop-breaker-and-guardrails.md) |
| **Phase 03** | Reasoning & CoT Budget Governor (Extended Thinking Throttler) | completed | 1.0h | [phase-03-reasoning-and-cot-budget-governor.md](file:///C:/Users/ADMIN/Documents/token-stack/plans/260903-0110-token-stack-3.0-expansion/phase-03-reasoning-and-cot-budget-governor.md) |
| **Phase 04** | Zero-Token Semantic Response Cache (SQLite-VSS Vector Cache) | completed | 2.0h | [phase-04-zero-token-semantic-cache.md](file:///C:/Users/ADMIN/Documents/token-stack/plans/260903-0110-token-stack-3.0-expansion/phase-04-zero-token-semantic-cache.md) |
| **Phase 05** | Model Cascading Router, Benchmark Suite & DX Integration | completed | 1.5h | [phase-05-model-cascading-router-and-benchmarks.md](file:///C:/Users/ADMIN/Documents/token-stack/plans/260903-0110-token-stack-3.0-expansion/phase-05-model-cascading-router-and-benchmarks.md) |

## Dependencies & Pre-requisites
- Token-Stack 2.0 CLI (`bin/token-stack.ps1`, `token-stack.registry.json`) is operational.
- Existing profiles (`kimicode`, `sub2api-01`, `sub2api-02`) remain active and verified.

## Validated Architectural Decisions
- **Decision 1 (Turn Folding)**: Use **5-turn Epoch Freezing** to preserve Anthropic prompt cache prefixes permanently.
- **Decision 2 (Waterfall Failover)**: Use **Transparent In-Flight Retry** (<500ms) across provider tiers upon 429/quota exhaustion.
- **Decision 3 (Semantic Cache Engine)**: Use **SQLite N-Gram Token Cosine Similarity** (Zero External Dependencies, pure Node.js runtime).
- **Decision 4 (CoT Budget Modulation)**: Use **Dynamic Task-Aware Budgeting** (1024 tokens for simple edits, 8192 tokens for architecture).

## Acceptance Criteria
- [ ] Turn Folding reduces payload by ≥50% in sessions >15 turns without schema breakages.
- [ ] Loop breaker catches 3x repeated tool calls and halts runaway token burn.
- [ ] Waterfall routing automatically fails over to alternate provider on 429/quota error.
- [ ] CoT governor trims thinking tokens on non-architectural turns.
- [ ] Semantic cache answers identical queries with 0 tokens and <20ms latency.
