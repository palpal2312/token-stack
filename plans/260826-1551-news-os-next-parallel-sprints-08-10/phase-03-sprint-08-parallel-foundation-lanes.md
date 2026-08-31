---
title: "Sprint 09 community escalation and controlled delivery"
status: in_progress
---

# Sprint 09 community escalation and controlled delivery

## Overview

Add the bounded community contribution/escalation path, connect it to the controlled workflow graph, and return signed Community Knowledge Snapshots to local SQLite. Community input is an untrusted candidate, never a direct canonical mutation or automatic promotion.

## Requirements

- [ ] Require explicit consent, authenticated actor/workspace, size/type limits, quarantine, provenance, and reversible moderation state.
- [ ] Accept only allowlisted Forecast Feature Records and normalized incident/evaluation facts from `community-queue.db`; reject raw project content and exact private identifiers.
- [ ] Validate signature, schema/policy version, dedupe key, evidence quality, plausibility, and poisoning/abuse indicators before aggregation.
- [ ] Keep upload/escalation local-first and fail closed when the canonical backend is unavailable.
- [ ] Publish signed/versioned snapshots containing matched priors, lane-efficiency curves, known failure signatures, validated recipes, compatibility facts, and calibration tables with sample size and uncertainty.
- [ ] Compile only approved, typed workflow graphs with bounded loops, budgets, checkpoints, cancellation, retry/fallback, and merge-queue safety.
- [ ] Preserve parent Task authority while child Attempts remain durable and auditable.

## Architecture and ownership

The community lane owns intake, quarantine, validation, moderation, aggregation, receipts, reject/export/delete, escalation, and signed snapshot publication. The controlled-delivery lane owns graph validation, compilation, checkpoints, and SEN progress. The local snapshot consumer verifies signature/version and stores advisory data without changing execution authority. They share only frozen contracts.
## Related Code Files

- `src/app/api/sen/knowledge/`
- `src/app/api/sen/operations/`
- `src/lib/llmops/workflow.ts`
- `go/internal/http/sen/`

## Implementation Steps

1. Reconcile S08-A/S08-B receipts and freeze the input contract revision.
2. Implement community candidate intake, quarantine, review, reject/export/delete, and escalation audit records.
3. Implement comparable-cohort aggregation and signed knowledge-snapshot publication/import with version, expiry, and rollback.
4. Implement graph validation/compilation and SEN preview/progress surfaces in separately owned paths where possible.
5. Prove malicious graph size/depth, duplicate events, cancellation tree, crash resume, worktree/merge safety, poisoned contribution rejection, and invalid snapshot rejection.
6. Run an arbiter against integrated evidence; do not promote candidate memory/procedure/workflow/estimator changes automatically.

## Success Criteria

- [ ] Community data never bypasses quarantine or consent.
- [ ] Users can inspect the exact normalized payload, delivery/publication receipt, and removal state.
- [ ] Community outage cannot block local chat, planning, orchestration, terminal attach, or Run completion.
- [ ] Imported snapshots are signed, versioned, reversible, and disclose cohort/sample-size/uncertainty boundaries.
- [ ] Graph execution respects WIP, approval, exclusive-resource, budget, and cancellation controls from S08-A.
- [ ] Context Pack lineage from S08-B is cited and stale-source behavior is visible.
- [ ] Legacy writer remains disabled and no Phase 21 command is issued.
- [ ] Independent arbiter records GO with no unresolved provenance or merge-safety findings.

## Risk Assessment

Uploads may contain poisoned instructions or sensitive material. Mitigate with quarantine, parser caps, redaction, provenance, human review, and delete/export controls before downstream use.
