---
phase: 1
title: "Multi-sprint preflight and contract freeze"
status: pending
priority: P1
effort: "2-4h"
dependencies: []
---

# Phase 1: Multi-sprint preflight and contract freeze

## Context links

- [Plan](./plan.md)
- `docs/orchestration-runbook.md`
- `.claude/skills/newos-master/SKILL.md`

## Overview

Prove that one controller can safely coordinate three sprint substates and that
the available Orca workers can sustain the selected physical concurrency.

## Requirements

- Resolve live agent commands, versions, authentication/capability and writable
  Orca terminals; executable presence alone is insufficient.
- Measure bounded local CPU, memory, disk and relevant accelerator/network
  pressure; classify active and candidate jobs by workload weight and preserve
  headroom for SEN, Orca, SQLite and the desktop.
- Count effective workers after quota/auth health, shared-provider pools and
  verified fallback coverage. A primary without a usable fallback contributes
  zero after provider exhaustion.
- Keep one controller generation and separate Sprint 05/06/07 queue counters.
- Build exact writer allowlists and reject every overlap before dispatch.
- Materialize per-lane `ACTIVE`, `NEXT`, `FALLBACK`, acceptance and evidence paths.

## Architecture

The controller state owns three sprint substates. The observer polls exact Orca
terminal handles without model calls. Dispatch remains event-driven. A
generation-fenced takeover transfers the entire state atomically.

## Related code files

- Read: `scripts/controller-failover.ps1`
- Read: `.claude/skills/newos-master/scripts/newos-master-state.ps1`
- Create at execution time: plan-scoped run config, state, worker inventory and ownership manifest
- Do not modify product code in this phase

## Implementation steps

1. Reconcile Sprint 04 closed evidence and confirm no live old controller lease.
2. Probe every candidate worker and fallback through Orca.
3. Compute Global OLC baseline, Effective Global OLC and Sprint OLC ranges;
   select physical concurrency from the current minimum constraint. Five is a
   ceiling for this run, never a forced target.
4. Generate three sprint backlogs and reject duplicate file ownership/task IDs.
5. Create per-sprint receipt roots, counters and arbiter routes.
6. Dry-run observer output and takeover without dispatching product jobs.

## Todo

- [ ] Closed prior-run state reconciled. (OPEN: historical plan dir; see roadmap track record)
- [ ] Worker/capability matrix current. (OPEN: historical plan dir; see roadmap track record)
- [ ] Host resource snapshot, workload weights and effective worker/fallback (OPEN: historical plan dir; see roadmap track record)
      capacity produce an explainable OLC decision.
- [ ] Ownership collision count equals zero. (OPEN: historical plan dir; see roadmap track record)
- [ ] Three queues contain ACTIVE/NEXT/FALLBACK coverage. (OPEN: historical plan dir; see roadmap track record)
- [ ] Observer and lease/takeover dry runs pass. (OPEN: historical plan dir; see roadmap track record)

## Success criteria

Machine-readable preflight returns GO with selected OLC/allocation, bounded host
resource evidence, exact terminal bindings, verified fallback coverage, zero
ownership overlap and Phase 21 blocked. Otherwise no sprint starts.

## Risk assessment

Stale auth, missing fallback or host pressure may make advertised capacity
unusable. Detect by live readiness and bounded resource evidence; stop new
admissions, lower Effective Global OLC and recalculate the schedule.

## Security considerations

Never persist dispatch capabilities, tokens, provider credentials or raw
terminal transcripts. Store identifiers, bounded deltas and redacted errors only.
