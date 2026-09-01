---
phase: 3
title: "CI and ops hardening"
status: pending
priority: P2
effort: ""
dependencies: [1]
---

# Phase 3: CI and ops hardening

## Overview
Switch CI to the actual package manager, add a daemon-backed integration job,
and verify the restore drill against the pre-cutover backup.

## Requirements
- Functional: CI green on pnpm; a job starts sen-plane and runs the canonical
  chat round-trip; restore drill completes against the out-of-git backup.
- Non-functional: no secrets in CI; no deploy steps.

## Related Code Files
- Modify: `.github/workflows/ci.yml` (pnpm, daemon job), scripts if any.
- Run: `scripts/dev-sen-plane.ps1`, `scripts/phase12-backfill-chat.ts --dry-run`.

## Implementation Steps
1. Switch CI install to pnpm and keep the test/go/tsc jobs.
2. Add a daemon integration job: start sen-plane on an ephemeral store, run a
   chat round-trip smoke.
3. Execute restore drill from `%LOCALAPPDATA%\NEWSOS\phase12-backups-20260901`
   (copy back, hash-verify) and record timestamps/hashes.

## Success Criteria
- [x] CI green with daemon job passing. (_evidence: see CLOSED_GO record)
- [x] Restore drill receipt records a clean copy-back verification. (_evidence: see CLOSED_GO record)
## Risk Assessment
pnpm pack/install differences from npm — signal: lockfile mismatch in CI;
response: generate pnpm-lock from package.json and commit if intended.