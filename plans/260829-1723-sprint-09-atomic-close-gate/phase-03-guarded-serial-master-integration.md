---
phase: 3
title: "Guarded serial master integration"
status: pending
priority: P1
effort: "2h"
dependencies: [1, 2]
---

# Phase 3: Guarded serial master integration

## Overview

Promote C2 then C3 into master through a single integration owner, with each
promotion independently receipted before the next starts.

## Requirements

- [ ] I4 product commit may touch only `src/lib/llmops/workflow.ts`, `src/lib/__tests__/workflow-graph.test.ts`, and `qa/fixtures/sprint09/graph-cases.json`; its receipt is a separate allowlisted evidence artifact. (OPEN: historical plan dir; see roadmap track record)
- [ ] I5 product commit may touch only `go/internal/localdb/community/s09_snapshot.go`, `go/internal/localdb/community/s09_snapshot_test.go`, and `qa/fixtures/sprint09/snapshot-cases.json`; its receipt is a separate allowlisted evidence artifact. (OPEN: historical plan dir; see roadmap track record)
- [ ] Each promotion uses current destination preimage checks, temporary index, one scoped commit, focused validation, and a master receipt. (OPEN: historical plan dir; see roadmap track record)

## Implementation Steps

1. Lane A executes I4; on any preimage or focused-test failure, stop and retain the failure evidence. Commit exactly the three product paths, then write/commit exactly the named receipt path through a separate temporary-index operation.
2. Lane A verifies I4 master hashes and receipt, then refreshes heartbeat.
3. Lane A executes I5 only after I4 acceptance; same product/evidence split and guard procedure.
4. Lane B stays read-only and prepares its final verification bundle from the actual I5 master state.

## Todo

- [ ] I4 master receipt hashes exactly match the committed C2 source paths. (OPEN: historical plan dir; see roadmap track record)
- [ ] I5 master receipt hashes exactly match the committed C3 source paths. (OPEN: historical plan dir; see roadmap track record)
- [ ] No user index entry, migration, or shared DTO file is included without explicit scope and receipt. (OPEN: historical plan dir; see roadmap track record)
- [ ] After every product and receipt commit, staged pathname set/hash/count and unrelated status match the Phase 1 baseline. (OPEN: historical plan dir; see roadmap track record)

## Success Criteria

- Both candidate feature sets are present in master through distinct, reviewable integration commits.

## Risk Assessment

Only one product/master integration writer is allowed. Controller orchestration
records are excluded from the immutable verification tree and may change only
after final GO. If the C3 source or destination changes
after I4, recompute hashes and reopen only I5; never amend I4 or use a broad
reset/checkout.
