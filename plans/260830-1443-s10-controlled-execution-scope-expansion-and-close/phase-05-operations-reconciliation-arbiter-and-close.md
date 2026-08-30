---
title: "Phase 5: Operations reconciliation arbiter and close"
status: todo
---

# Phase 5: Operations reconciliation arbiter and close

## Overview

Assemble the portable close packet, reconcile live Orca/Git/process state, and obtain one independent S10 arbiter verdict.

## Requirements

- [ ] Packet links every receipt, hash, risk, runbook, snapshot, and handoff artifact.
- [ ] Arbiter verifies current bytes, tests, ownership, no orphan/legacy/Phase21 transitions, and all acceptance criteria.

## Implementation Steps

1. Freeze writers and re-run receipt/test/security gates.
2. Reconcile Orca tasks, controller lease, processes, and manifest state.
3. Dispatch independent arbiter; on GO write `CLOSED_GO`, otherwise retain diagnosed NO_GO.

## Todo

- [ ] Current-byte close packet and risk ledger
- [ ] Independent arbiter report and final handoff

## Success Criteria

- [ ] Arbiter returns GO and close record is atomically promoted.
- [ ] Finalize is run only after GO; legacy writer disabled and Phase 21 blocked remain explicit.
