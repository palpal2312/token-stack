# Phase 03: Reasoning & CoT Budget Governor (Extended Thinking Throttler)

## Context Links
- Parent Plan: [plan.md](file:///C:/Users/ADMIN/Documents/token-stack/plans/260903-0110-token-stack-3.0-expansion/plan.md)
- Reference Specification: Anthropic Extended Thinking API (`thinking.budget_tokens`)
- Open-Source Reference: `sgl-project/sglang` constrained reasoning

## Overview
- **Date**: 2026-09-03
- **Description**: Dynamically modulate reasoning token budgets (`thinking.budget_tokens`) based on prompt complexity, preventing hidden CoT bloat on routine tasks while reserving deep reasoning for complex architecture.
- **Priority**: P2
- **Implementation Status**: pending
- **Review Status**: pending

## Key Insights
- Models like Claude 3.7 Sonnet Thinking, o1/o3-mini, and DeepSeek R1 generate thousands of invisible chain-of-thought tokens.
- For trivial edits (e.g. changing CSS, renaming a symbol, single-line bugfix), models default to 4,000–8,000 thinking tokens, accounting for up to 80% of request cost.
- Dynamically throttling `budget_tokens` saves massive amounts of time and money without degrading answer quality on simple tasks.

## Requirements
1. Implement `core/cot-governor.cjs`:
   - Inspects outgoing request body for `thinking` configuration.
   - If `thinking: { type: "enabled" }` is present:
     - Classifies turn intent:
       - **Low-Complexity Tasks** (single-file edit, formatting, regex, git commit):
         - Caps `budget_tokens = 1024`.
       - **Medium-Complexity Tasks** (standard feature implementation, test creation):
         - Caps `budget_tokens = 2048` or `4096`.
       - **High-Complexity Tasks** (multi-file refactoring, concurrency bugs, architectural design):
         - Allows full user budget (e.g. `8192`–`16384`).
   - If user explicitly forces budget via comment or CLI flag, respects user preference.

## Architecture
```text
[Outgoing Request] ──> [CoT Governor Classifier]
                              │
     ┌────────────────────────┼────────────────────────┐
     ▼ (Low Complexity)       ▼ (Medium Complexity)    ▼ (High Complexity)
[budget_tokens = 1024]   [budget_tokens = 4096]   [budget_tokens = 8192+]
```

## Related Code Files
- `C:\Users\ADMIN\Documents\token-stack\core\cot-governor.cjs`
- `C:\Users\ADMIN\Documents\token-stack\bin\token-stack.ps1`

## Implementation Steps
1. Create `core/cot-governor.cjs` with rule-based prompt classifier.
2. Intercept and rewrite `thinking.budget_tokens` dynamically.
3. Test against Claude 3.7 Thinking API endpoint.
4. Measure response latency and token delta.

## Todo List
- [ ] Create `core/cot-governor.cjs`
- [ ] Implement intent scoring heuristics
- [ ] Validate Anthropic API schema compliance
- [ ] Measure token reduction on quick-edit benchmarks

## Success Criteria
- On simple 1-file edits, thinking tokens drop from ~5,000 to <1,200 tokens (-75%).
- Response latency improves by 2x on simple turns.
