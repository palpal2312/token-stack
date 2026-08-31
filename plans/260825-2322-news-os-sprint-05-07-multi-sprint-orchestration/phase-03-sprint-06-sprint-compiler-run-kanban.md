---
phase: 3
title: "Sprint 06 Sprint compiler and Run Kanban"
status: pending
priority: P1
effort: "32-36 agent-hours; <=48h sprint timebox"
dependencies: [1]
---

# Phase 3: Sprint 06 Sprint compiler and Run Kanban

## Overview

Compile approved Goal Features into Orca Runs and expose each Run as one Kanban
card with editable Task workflow, bounded loops and whole-Run review.

## Start gate

Implementation may start after `S05-G1`; final GO still depends on Sprint 05 GO.
The phase dependency records the final gate, while the execution graph permits
the controlled overlap.

## Requirements

- No Card/Run or execution before user approval of timebox, lanes, workers and budget.
- The proposal distinguishes Global OLC baseline, Effective Global OLC, Sprint
  OLC and per-Sprint lane allocation, with machine/resource, quota/fallback,
  dependency, ownership and budget reasons.
- Lane admission uses weighted workload capacity. Heavy build/test/local-model
  work can consume multiple capacity units; terminal count is not capacity.
- One card equals one Orca Run; multi-task Runs require at least a sequence workflow.
- Task loops are bounded and observable; review/acceptance is Run-level.
- Project SEN is the only user-facing coordinator and Orca is execution authority.

## Architecture

Lane 1 owns proposal/timebox/budget/OLC explanation UX. Lane 2 owns feature
slicing, advisory allocation, OLC calculation and workflow/loop editing. Lane 3
owns proposal-to-Orca compilation, privacy-safe session telemetry, progress
projection and Run-level readiness/review gates.

## Related code files

- Create: `go/internal/sprintcompiler/**`
- Create: `src/lib/run-kanban/**`
- Modify only from the Sprint-06 allowlist: `src/lib/agent-kanban/**`
- Create: `src/app/api/sen/sprints/**`
- Modify only designated Run endpoints under `src/app/api/sen/runs/**`
- Create: `qa/fixtures/sprint06/**`

## Implementation steps

1. Pin S05 contract version and refuse unpinned identity/scope input.
2. Build proposal and approval contract without execution side effects.
3. Build Feature slicer/advisory allocator and explain worker/budget reasoning.
4. Add OLC inputs, weighted workload admission, dynamic downshift and
   user-approved upshift ceilings. Treat shared provider pools and missing
   fallback as reduced effective capacity.
5. Define session events and local aggregates for active/idle/blocked time,
   bounded resource samples, quota/fallback health, conflict/rework, token or
   agent-time bucket, receipt latency and final review outcome.
6. Build Run-card, workflow and bounded-loop contracts.
7. Compile approved proposal to Orca Run DAG and project status back to SEN.
8. Verify no direct sub-agent chat or non-Orca worker launch path.
9. Wait for Sprint 05 GO, then promote and run independent Sprint 06 arbiter.

## Todo

- [ ] S06 logical lanes prepared with ACTIVE/NEXT/FALLBACK.
- [ ] Approval-before-materialization gate passes.
- [ ] OLC proposal and recalculation fixtures cover idle, heavy-load,
      host-pressure, shared-quota, exhausted-primary and no-fallback cases.
- [ ] Session telemetry is corroborated by Orca/evidence and excludes project
      content, prompts, raw terminal output and credential material.
- [ ] Card=Run and workflow/loop invariants pass.
- [ ] Orca-only execution boundary passes.
- [ ] Run-level readiness/review gate passes.
- [ ] Sprint 05 GO consumed by hash.
- [ ] Independent Sprint 06 arbiter returns GO.

## Success criteria

An approved proposal deterministically creates Orca Runs; unapproved proposals
create none; every visible card maps to exactly one Run and one review verdict.
SEN explains and safely recalculates OLC, and its Sprint allocations never
exceed current effective capacity or the user's approved maximum/budget.

## Risk assessment

Legacy Product Task board assumptions may leak into the new board. Scan for
task-card authority and direct execution. Move conflicting shared files to the
integration owner instead of permitting concurrent edits.

Sparse history can overstate capacity. Cold start conservatively, use verified
workers and host headroom, and learn only from accepted outcomes; failed,
reworked or conflict-heavy runs are not positive OLC labels.

## Security considerations

Approval receipts bind proposal hash, worker set, budget and timebox. Reject
stale approvals, unbounded loops and direct worker invocation.
