---
phase: 2
title: "UI canonical consumption + dispatch fix"
status: pending
priority: P1
effort: ""
dependencies: [1]
---

# Phase 2: UI canonical consumption + dispatch fix

## Overview
The chat UI renders canonical receipts end-to-end and kanban dispatch works in
daemon mode; slots/attempts views read store data with explicit empty states.

## Related Code Files
- Modify: `src/app/api/agent-kanban/dispatch/route.ts` (sessionId alias pass),
  Sen chat UI consumers, slots/attempts views.

## Implementation Steps
1. Confirm dispatch payloads map sessionId (alias fix from S15 P2 extends fully).
2. Chat view consumes the adapter shape (turnId/chatAttemptId).
3. Slots/attempts views show real counts or explicit empty state.

## Success Criteria
- [ ] Dispatch works with daemon active.
- [ ] Chat turn row keyed on turnId; no 404 on attempt-scoped reads.
- [ ] Empty store renders empty-state, not error.

## Risk Assessment
Seed legacy data shape drift — signal: chat view shows stale shapes; response:
single adapter seam already centralizes mapping.
