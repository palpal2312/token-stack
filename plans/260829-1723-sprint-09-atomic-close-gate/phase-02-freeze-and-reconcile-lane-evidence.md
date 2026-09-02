---
phase: 2
title: "Reconcile source and master preconditions"
status: pending
priority: P1
effort: "1h"
dependencies: [1]
---

# Phase 2: Reconcile source and master preconditions

## Overview

Confirm that the actual master worktree can safely receive the two isolated
candidates and isolate all unowned drift before integration begins.

## Requirements

- [ ] Inventory dirty master state without mutating it. (OPEN: historical plan dir; see roadmap track record)
- [ ] Compute destination preimages for the C2 and C3 path sets. (OPEN: historical plan dir; see roadmap track record)
- [ ] Confirm only `palpal2312/admin` will write master. (OPEN: historical plan dir; see roadmap track record)
- [ ] Treat `src/lib/llmops/contracts.ts` as an explicit hold-point. (OPEN: historical plan dir; see roadmap track record)
- [ ] Produce a read-only field-by-field DTO-delta comparison and a user decision packet; no lane edits it. (OPEN: historical plan dir; see roadmap track record)

## Implementation Steps

1. Lane A derives exact source/destination hash maps from C2 and C3 receipts.
2. Controller ensures C2 and C3 destination sets do not overlap and stages no user files.
3. Lane B prepares read-only post-I5 test commands and expected artifact hashes.
4. Lane C updates its candidate manifest to identify what remains pending promotion.

## Todo

- [ ] C2 destination preimages match or I4 stops without forced merge. (OPEN: historical plan dir; see roadmap track record)
- [ ] C3 destination preimages match after I4 or I5 stops without forced merge. (OPEN: historical plan dir; see roadmap track record)
- [ ] The contracts.ts decision is recorded as unresolved rather than silently absorbed. (OPEN: historical plan dir; see roadmap track record)
- [ ] Any user decision becomes a named, separately scoped task; without it the final arbiter must return NO-GO. (OPEN: historical plan dir; see roadmap track record)

## Success Criteria

- The next master writer has a precise allowlist, rollback commit references, and temporary-index procedure.

## Risk Assessment

Dirty user state can be accidentally swept into a commit. The only permitted
response to any allowlist/preimage mismatch is to stop, preserve evidence, and
request a new bounded decision.
