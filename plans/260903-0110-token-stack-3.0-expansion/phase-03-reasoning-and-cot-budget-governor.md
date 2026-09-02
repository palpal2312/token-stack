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

## Architecture & Task-Aware Budget Modulation
```text
[Incoming Turn Request] ──> [Task Intent Classifier]
                                    │
     ┌──────────────────────────────┼──────────────────────────────┐
     ▼ (Low Complexity)             ▼ (Medium Complexity)          ▼ (High Complexity)
[budget_tokens = 1024]         [budget_tokens = 4096]         [budget_tokens = 8192+]
- Commit messages              - Standard feature code        - Architectural design
- Lint / CSS / Typo fixes      - Unit test implementation     - Multi-file refactoring
- Formatting / Regex           - Single-module debugging      - Concurrency & race bugs
```

### Intent Classification Rules
```javascript
function evaluateThinkingBudget(turnText, fileCount = 1) {
  const text = turnText.toLowerCase();
  // High complexity triggers
  if (/architect|refactor|memory\s*leak|concurrency|race\s*condition|redesign/i.test(text) || fileCount > 3) {
    return 8192;
  }
  // Low complexity triggers
  if (/commit|format|typo|rename|css|style|clean|license|readme/i.test(text) && fileCount <= 1) {
    return 1024;
  }
  // Default medium complexity
  return 4096;
}
```

### Payload Injection Spec
- If request contains `thinking: { type: "enabled" }`:
  - Replace `budget_tokens` with calculated value.
  - Set `max_tokens` appropriately (`budget_tokens + 4096`).
- Ensures the model does not spend 6,000 thinking tokens on a 2-line typo fix!

## Concrete Test Cases
- **Test 1 (Low Budget Enforcement)**: Request asking "Fix typo in button label" gets `budget_tokens: 1024`; model responds in <2s instead of 10s.
- **Test 2 (High Budget Allocation)**: Request asking "Redesign multi-thread database connection pool" gets `budget_tokens: 8192` allowing full deep reasoning.
- **Test 3 (User Override)**: Request with explicit prompt comment `<!-- budget: 16000 -->` respects user override.

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
