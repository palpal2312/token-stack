# Phase 01: Dynamic In-Flight Turn Folding (Historical Context Compactor)

## Context Links
- Parent Plan: [plan.md](file:///C:/Users/ADMIN/Documents/token-stack/plans/260903-0110-token-stack-3.0-expansion/plan.md)
- Theoretical Basis: `mit-han-lab/streaming-llm` (Attention Sinks)
- Practical Reference: `cline/cline` context manager (tool truncation)

## Overview
- **Date**: 2026-09-03
- **Description**: Implement an in-flight conversation folding engine that automatically condenses stale tool outputs in long-running sessions, preventing mid-session context bloat while preserving Anthropic prompt caching.
- **Priority**: P1 (Highest Urgency)
- **Implementation Status**: pending
- **Review Status**: pending

## Key Insights
- In sessions exceeding 15 turns, stale `tool_result` blocks (`view_file` 500 lines, old `grep_search` matches) continue to re-transmit on every turn, driving payload sizes up to 80k tokens.
- Models do not need full file contents from 10 turns ago; they only need to know what was found or that the action succeeded.
- To prevent breaking Anthropic's prompt cache, folding must occur in discrete milestones (e.g. freezing turns 1-5, then turns 6-10) rather than changing every single turn.

## Requirements
1. Implement `core/turn-folder.cjs`:
   - Inspects `messages: [...]` payload in `POST /v1/messages`.
   - Identifies cold turns (older than the last 4 active turns).
   - In cold turns, truncates `tool_result` blocks exceeding 1,000 characters:
     - Keeps first 5 lines.
     - Inserts `[... N lines / M characters folded by Token-Stack ...]`.
     - Keeps last 3 lines.
   - Preserves `tool_use_id` and schema invariants so API requests are never rejected with HTTP 400.
2. Milestone / Epoch Freeze:
   - Folds in fixed 5-turn epochs to preserve prompt cache breakpoints.
3. CLI Integration:
   - Expose `--fold` flag in `token-stack up` and configure default folding threshold in `token-stack.registry.json`.

## Architecture & 5-Turn Epoch Freezing Algorithm
```text
[Client Request: N turns] ──> [Turn-Folder Middleware] ──> [Headroom Proxy] ──> [Upstream API]
                                     │
    ┌────────────────────────────────┼────────────────────────────────┐
    ▼ (Milestone Turns <= N - 4)     ▼ (Epoch Boundary)               ▼ (Active Reasoning Window)
[Turns in completed 5-turn epochs] [Turns N-4 to N-1 in curr epoch] [Turns N-3 to N: 100% Raw]
  - Fold tool_results > 1000 ch    - Evaluated, stable prefix        - Full code & detailed outputs
  - FROZEN IN PROMPT CACHE         - Cache milestone pending        - Deep model attention
```

### Algorithm Specification: `FoldColdEpochs(messages, currentEpochSize = 5, liveWindow = 4)`
1. **Live Window Exemption**: The last `liveWindow` (4) messages are never modified.
2. **Epoch Boundary Detection**: Compute `completedEpochCount = Math.floor((messages.length - liveWindow) / currentEpochSize)`.
3. **Folding Threshold**: For any message in `[0, completedEpochCount * currentEpochSize]`:
   - Iterate over `message.content` array.
   - For items with `item.type === "tool_result"`:
     - If `item.content.length > 1000`:
       - Parse lines: `lines = item.content.split('\n')`.
       - If `lines.length > 15`:
         - Preserve first 5 lines (header/context).
         - Insert: `\n[... Folded ${lines.length - 8} lines by Token-Stack L7 ...]\n`.
         - Preserve last 3 lines (exit code/summary).
       - Ensure `item.tool_use_id` and `item.type` remain completely untouched.
4. **Cache Preservation Invariant**: Once an epoch (e.g. Turns 1–5) is folded, its serialized string is hashed and stored in memory. It is never re-folded or mutated again, ensuring 100% Anthropic Prompt Cache hits on subsequent turns!

## Concrete Test Cases
- **Test 1 (Schema Compliance)**: A 10-turn conversation with `tool_result` blocks returns valid Anthropic JSON; `tool_use_id` matches callee.
- **Test 2 (Token Reduction)**: A 25-turn conversation containing 5 `view_file` calls (800 lines each) drops from ~75,000 tokens to <18,000 tokens (>75% savings).
- **Test 3 (Prompt Cache)**: Two consecutive requests at Turn 12 and Turn 13 share identical Epoch 1 (Turns 1–5) and Epoch 2 (Turns 6–10) prefixes, achieving >90% cache read discount.

## Implementation Steps
1. Create `core/turn-folder.cjs` with pure Node.js HTTP proxy stream transformer.
2. Implement `foldMessages(messages, options)` with unit test coverage.
3. Wire folding middleware into Headroom proxy dispatch.
4. Verify end-to-end streaming with Claude Code session >15 turns.

## Todo List
- [ ] Create `core/turn-folder.cjs`
- [ ] Implement `foldMessages` algorithm
- [ ] Implement epoch freezing logic for prompt cache
- [ ] Test with synthetic 20-turn payload
- [ ] Verify Anthropic and Kimi API compatibility

## Success Criteria
- In a 20-turn benchmark session, payload size is reduced by ≥55%.
- Anthropic API returns `200 OK` with valid streaming events.
- Prompt cache hit rate remains ≥85%.

## Risk Assessment & Rollback
- **Risk**: Over-truncating could hide necessary stack traces or file content.
- **Mitigation**: Never fold the 4 most recent turns; never fold lines containing `Error:`, `Exception:`, or `failed:`.
