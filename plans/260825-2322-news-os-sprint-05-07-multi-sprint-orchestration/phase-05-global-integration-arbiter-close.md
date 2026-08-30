---
phase: 5
title: "Global integration, arbiter and close"
status: pending
priority: P1
effort: "8-12 agent-hours"
dependencies: [2, 3, 4]
---

# Phase 5: Global integration, arbiter and close

## Overview

Integrate only independently accepted outputs, verify current bytes across all
three sprints and close the shared controller without changing Phase 21 status.

## Requirements

- One integration owner handles shared schemas, exports, routes and generated artifacts.
- Producer writers are frozen before current-byte manifests are computed.
- Each sprint has independent GO; global arbiter reruns cross-sprint gates.
- Final evidence compares proposed versus actual OLC, allocations, weighted
  load, resource pressure, worker/fallback availability, quality and wall time.
- Controller release happens only after manifest `closed_go` and post-release check.

## Architecture

Sprint manifests feed a global manifest containing contract versions, hashes,
test commands and verdicts. Integration is sequential for shared files. The
global arbiter is independent from producers and controller.

## Related files

- Modify if required by accepted interfaces: shared SQLite migration registration and shared exports/routes
- Create: plan-scoped global manifest, integration receipts and arbiter report
- Update only from evidence: canonical plan/HANDOFF and orchestration memory
- Do not create or modify Phase 21 artifacts

## Implementation steps

1. Freeze all writers and reject stale/superseded receipts.
2. Integrate accepted outputs in dependency order: Sprint 05, then 06/07.
3. Resolve shared-file changes through the sole integration owner.
4. Run focused package/fixture gates, then broad build/test/privacy scans.
5. Compute current-byte global manifest and run independent global arbiter.
6. On NO-GO, reopen only exact owned corrections and rerun affected gates.
7. Produce privacy-safe local OLC aggregates and reject any learning label from
   failed, over-budget, conflict-heavy or review-rejected execution.
8. On GO, update plan/HANDOFF, finalize manifest, release lease, disable detector
   and execute post-release close gate.

## Todo

- [ ] Sprint 05/06/07 independent verdicts are GO.
- [ ] Shared-file integration has one writer and zero unresolved conflicts.
- [ ] Current-byte hashes and completion markers verify.
- [ ] Cross-sprint privacy, recovery and Orca boundaries pass.
- [ ] OLC retrospective and session aggregate privacy gate pass.
- [ ] Global arbiter returns GO.
- [ ] Lease released; detector disabled; post-release gate GO.
- [ ] Phase 21 still blocked.

## Success criteria

The multi-sprint manifest reports `closed_go`, all three sprint manifests and
current hashes verify, no active/unresolved task remains, and Phase 21 is unchanged.

## Risk assessment

Separate worktrees defer shared-file conflicts. They do not solve them. Any
collision is sequenced through the integration owner and reverified after merge.

## Security considerations

Run the boundary/secret scan before promotion. Receipts and manifests contain
only IDs, hashes, paths and redacted verdicts; never credentials or capabilities.
