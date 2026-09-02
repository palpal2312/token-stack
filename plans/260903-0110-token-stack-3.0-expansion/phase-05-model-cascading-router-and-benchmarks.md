# Phase 05: Model Cascading Router, Benchmark Suite & DX Integration

## Context Links
- Parent Plan: [plan.md](file:///C:/Users/ADMIN/Documents/token-stack/plans/260903-0110-token-stack-3.0-expansion/plan.md)
- Reference Frameworks: `lmsys/RouteLLM`, `stanford-futuredata/FrugalGPT`

## Overview
- **Date**: 2026-09-03
- **Description**: Implement a fast model cascading router that dispatches trivial coding tasks to cheap/free models and complex architecture to flagship models, update the benchmark suite to measure the 12-layer stack, and provide unified CLI controls.
- **Priority**: P2
- **Implementation Status**: completed
- **Review Status**: verified

## Key Insights
- Dispatching every minor file tweak to flagship models (Opus, Sonnet) inflates operational cost by 5x–10x.
- Routing trivial tasks (commit messages, doc formatting, minor syntax questions) to DeepSeek-V3, Qwen 2.5 Coder, or Gemini Flash retains 98% benchmark accuracy while cutting cost by up to 80%.

## Requirements
1. Implement `core/model-router.cjs`:
   - Inspects task intent and complexity:
     - **Cheap Tier**: Commits, docstrings, JSON format, single-line CSS/HTML tweaks -> Routes to `kimi-k3` or `qwen3.8-max` / `deepseek-v3`.
     - **Flagship Tier**: Architecture, multi-file refactoring, debugging -> Routes to `claude-sonnet-4-5-thinking` / `opus`.
   - Respects user explicit overrides (e.g. if user specified `/model opus`).
2. Benchmark Suite Updates:
   - Update `skills/token-stack-benchmark/scripts/benchmark-tui.cjs` to include:
     - Layer 7 (Turn Folding)
     - Layer 8 (Loop Breaker)
     - Layer 9 (CoT Governor)
     - Layer 10 (Semantic Cache)
     - Layer 11 (Model Router)
   - Measure and output 12-layer ablation report.
3. Documentation & DX:
   - Update `README.md`, `README-vi.md`, and `docs/architecture.md` to reflect the 12-Layer Master Architecture.
   - Update `Makefile` with targets for all new layers.

## Architecture
```text
[Incoming Query] ──> [Query Complexity Classifier]
                             │
          ┌──────────────────┴──────────────────┐
          ▼ (Complexity < Threshold)            ▼ (Complexity >= Threshold)
   [Cheap/Fast Tier: Kimi / DeepSeek]    [Flagship Tier: Claude 3.7 / Opus]
   (Format, commit, regex, lookup)       (Architecture, complex debugging)
```

## Related Code Files
- `C:\Users\ADMIN\Documents\token-stack\core\model-router.cjs`
- `C:\Users\ADMIN\Documents\token-stack\skills\token-stack-benchmark\scripts\benchmark-tui.cjs`
- `C:\Users\ADMIN\Documents\token-stack\docs\architecture.md`

## Implementation Steps
1. Create `core/model-router.cjs` with rule-based classification heuristics.
2. Update `benchmark-tui.cjs` to incorporate all 12 layers into the interactive TUI.
3. Run comprehensive benchmark across all 5 standard scenarios.
4. Update multi-lingual documentation and release Token-Stack 3.0.

## Todo List
- [ ] Create `core/model-router.cjs`
- [ ] Update `benchmark-tui.cjs` with 12 layers
- [ ] Run full 12-layer ablation benchmark
- [ ] Update `docs/architecture.md` and READMEs

## Success Criteria
- Trivial turns route to fast tier with 10x cost reduction.
- Benchmark suite tests all 12 layers and records >96% overall token reduction.
