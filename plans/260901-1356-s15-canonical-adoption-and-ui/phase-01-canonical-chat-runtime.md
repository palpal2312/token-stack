---
phase: 1
title: "Canonical chat runtime adoption"
status: pending
priority: P1
effort: ""
dependencies: []
---

# Phase 1: Canonical chat runtime adoption

## Overview
Make the canonical Go chat path the default runtime path the app uses, instead
of opt-in `SEN_DAEMON_URL`.

## Requirements
- Functional: chat client accepts the canonical warm receipt
  (commandId/turnSeq/turnId/chatAttemptId/status); dev/run start sen-plane +
  set canonical env; legacy JSONL path provable as non-default.
- Non-functional: no silent dual-write; fallback stays offline/fail-closed only.

## Architecture
- Align `src/lib` chat client types/parsers to the sen-plane `/api/v1/sen/chat`
  receipt (map legacy field names in the consumer, not the daemon).
- Dev-loop: the run path starts `go/bin/sen-plane.exe` (via the S14
  `dev-sen-plane.ps1` pattern) against the store root and sets `SEN_DAEMON_URL`.
- Default: `SEN_DAEMON_URL` configured in dev/CI; legacy FirstMate path remains
  reachable only when explicitly unset (rollback guard kept).

## Related Code Files
- Modify: `src/lib/agentRuntime/go-builder-exec-client.ts` (receipt mapping),
  `src/app/api/sen/chat/route.ts`, `package.json` (dev script), run/dev harness.
- Read: `scripts/dev-sen-plane.ps1`, `scripts/phase12-backfill-chat.ts`.

## Implementation Steps
1. Map canonical receipt -> the chat client's expected shape in one adapter module.
2. Wire dev/start to spawn sen-plane + set `SEN_DAEMON_URL`.
3. Prove legacy path is non-default (env absence throws/fails closed).
4. Round-trip chat turn through the running app (build + probe).

## Success Criteria
- [ ] Chat turn POST->daemon->store->GET verified in the app runtime.
- [ ] No adapter hacks duplicated; single mapping module used by consumers.

## Risk Assessment
UI consumers using the old shape could break if seeded legacy data is read —
signal: chat view shows stale shapes in a seeded run; response: keep the mapping
module as the only seam before any UI change.