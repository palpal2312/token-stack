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

## Architecture
```text
[Client Request] ──> [Turn-Folder Engine] ──> [Headroom Proxy] ──> [Upstream API]
                          │
       ┌──────────────────┴──────────────────┐
       ▼ (Cold turns > 4 steps ago)          ▼ (Recent turns 1-4)
[Fold tool_result > 1000 chars]       [Pass through 100% untouched]
```

## Related Code Files
- `C:\Users\ADMIN\Documents\token-stack\core\turn-folder.cjs`
- `C:\Users\ADMIN\Documents\token-stack\bin\token-stack.ps1`
- `C:\Users\ADMIN\Documents\token-stack\token-stack.registry.json`

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
