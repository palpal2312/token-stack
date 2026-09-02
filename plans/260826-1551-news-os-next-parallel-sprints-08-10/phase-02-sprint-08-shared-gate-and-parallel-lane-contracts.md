---
title: "Sprint 08 parallel foundation lanes"
status: todo
---

# Sprint 08 parallel foundation lanes

## Overview

Run three isolated foundation lanes in parallel. S08-A implements durable admission/approval automation and forecast presentation; S08-B implements governed memory and deterministic Context Packs; S08-C implements local execution learning and privacy-safe forecast features. All consume only contracts approved by Phase 1.

## Requirements

- [ ] S08-A covers WIP/budget/dependency admission, durable approvals, and restart-safe automation. (OPEN: historical plan dir; see roadmap track record)
- [ ] S08-B covers working/episodic/semantic/procedural memory boundaries, provenance, quarantine, and deterministic cited Context Packs. (OPEN: historical plan dir; see roadmap track record)
- [ ] S08-A shows sequential-work estimate, critical path, useful lane range, elapsed-time interval, review/retry allowance, resource/cost assumptions, and confidence before approval. (OPEN: historical plan dir; see roadmap track record)
- [ ] S08-C records every terminal Run, derives reproducible Forecast Feature Records, and records estimator/policy versions plus estimate-versus-actual error. (OPEN: historical plan dir; see roadmap track record)
- [ ] All lanes enforce ACL-before-ranking, secret redaction, idempotency, and auditability where applicable. (OPEN: historical plan dir; see roadmap track record)
- [ ] Each producer lane owns separate files, migrations, fixtures, and reports; shared migration registration is serialized by the integration owner. (OPEN: historical plan dir; see roadmap track record)

## Architecture and ownership

S08-A owns allocator, WIP, approval, scheduler, and forecast UX surfaces. S08-B owns memory, Context Pack, indexing, and ingestion surfaces. S08-C owns Run-learning persistence, forecast-feature derivation, calibration facts, and local contribution-candidate derivation. Shared DTO and migration registrations return to the Phase 1 integration owner.
## Related Code Files

- `src/lib/llmops/`
- `src/app/api/sen/`
- `go/internal/`
- `plans/scripts/`

## Implementation Steps

1. Launch S08-A and S08-B through Orca only after the shared gate receipt.
2. S08-A reuses builder health/quota/credential patterns and replaces process-local ownership with durable admission records.
3. S08-B adds safe ingestion/quarantine, deterministic pack hashing, and rebuildable projections.
4. S08-C persists approved estimate and actual execution facts, derives content-free features, and proves crash/replay/idempotency behavior.
5. Run focused race, restart, security, privacy, and determinism tests per lane.
6. Freeze all three lane outputs and verify current bytes before integration.

## Success Criteria

- [ ] S08-A proves approval race/expiry/crash, scheduler catch-up once, WIP fairness, budget breach, and unauthorized decision cases. (OPEN: historical plan dir; see roadmap track record)
- [ ] S08-B proves ACL-before-ranking, superseded exclusion, correction audit, deletion/export, stale-source marking, parser caps, and FTS fallback. (OPEN: historical plan dir; see roadmap track record)
- [ ] S08-C proves one learning record per terminal Run, estimate/actual lineage, deterministic feature derivation, forbidden-field rejection, idempotent contribution candidates, and rebuildable calibration facts. (OPEN: historical plan dir; see roadmap track record)
- [ ] Forecast UI never implies linear speedup and displays `low confidence / out of distribution` for unsupported cohorts. (OPEN: historical plan dir; see roadmap track record)
- [ ] No lane changes `src/app/api/sen/chat`, enables `SEN_CHAT_LEGACY_WRITER`, or changes Phase 21 state. (OPEN: historical plan dir; see roadmap track record)
- [ ] All lane arbiters return GO with reproducible receipts. (OPEN: historical plan dir; see roadmap track record)

## Risk Assessment

Parallel work can drift from shared DTOs or duplicate migrations. Mitigate with immutable contract revisions and an integration owner who rejects untracked changes.
