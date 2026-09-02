---
phase: 5
title: "Single close-gate transition"
status: pending
priority: P1
effort: "1h"
dependencies: [4]
---

# Phase 5: Single close-gate transition

## Overview

Make one controller-owned close decision only after final GO, then persist the
state transition and continuation boundary without widening scope.

## Requirements

- [ ] Accept only a current-byte final arbiter GO and verified manifest. (OPEN: historical plan dir; see roadmap track record)
- [ ] Run the one allowed Sprint 09 CloseGate transition through Orca. (OPEN: historical plan dir; see roadmap track record)
- [ ] Update the run manifest, handoff, and plan status from durable evidence. (OPEN: historical plan dir; see roadmap track record)
- [ ] Keep legacy writer disabled and Phase 21 blocked. (OPEN: historical plan dir; see roadmap track record)

## Implementation Steps

1. Controller reconciles all lane tasks/terminals/receipts, fences writers, rehashes the frozen verification tree, and compares it with the arbiter-tested manifest/commits.
2. Controller invokes CloseGate only with expected open run state plus current controller generation or an Orca idempotency key. On ambiguity, inspect durable run state before any second action.
3. Controller verifies close result, refreshes heartbeat, updates handoff/plan, releases the Sprint 09 controller lease and disables its run-specific failover detector, then prepares Sprint 10 without starting it.

## Todo

- [ ] CloseGate is never invoked after an arbiter NO-GO, unavailable check, or unresolved drift. (OPEN: historical plan dir; see roadmap track record)
- [ ] All three lanes are settled with durable receipts. (OPEN: historical plan dir; see roadmap track record)
- [ ] Sprint 09 is marked closed exactly once; Phase 21 remains blocked. (OPEN: historical plan dir; see roadmap track record)
- [ ] Post-fence hashes and master commit/tree equal the final arbiter inputs. (OPEN: historical plan dir; see roadmap track record)
- [ ] Lease release and detector disable are verified after durable close-state confirmation. (OPEN: historical plan dir; see roadmap track record)

## Success Criteria

- The run state, handoff, and plan all identify the same close verdict and evidence paths.

## Risk Assessment

If any lane disagrees with the manifest or final arbiter, retain the gate as
open, reopen only the failing owned task, and repeat Phase 4 after correction.
