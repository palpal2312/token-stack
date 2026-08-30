# Sprint 08 lane manifest

- Contract package: `news-os.sprint08.contract-freeze`
- Revision: `1.0.0`
- Frozen: 2026-08-26
- Gate recommendation: **HOLD**
- Scope: coordination contracts only; no feature implementation, migration registration, legacy-writer change, or Phase 21 change

## Immutable inputs

- Coordinator plan: `plans/260826-1551-news-os-next-parallel-sprints-08-10/plan.md`
- Shared-gate report: `plans/reports/orchestrate-260826-sprint08-10/shared-gate/sprint08-shared-gate-report.md`
- Sprint 05-07 dependency: `closed_go` (accepted as immutable baseline by the shared gate)

The coordinator plan is not present in this lane branch. It was read from the authoritative coordinator worktree; it must be promoted into the lane base revision before producer worktrees are created.

## Exclusive producer ownership

| Lane | ACTIVE | Owned write set | NEXT | FALLBACK | Dependencies |
|---|---|---|---|---|---|
| S08-A | Admission, durable approval, scheduler, forecast UX | `go/internal/scheduler/**`; `go/internal/allocator/**`; new approval/admission packages under `go/internal/` using only the A migration reservation; `src/app/api/sen/scheduler/**`; `src/features/forecast/**`; `qa/fixtures/sprint08/a/**`; `plans/reports/orchestrate-260826-sprint08-10/lane-a/**` | Focused approval race/expiry/crash, catch-up-once, WIP fairness, budget, and unauthorized-decision tests | Read-only forecast UX/test review; no shared-file edit | Contract revision 1.0.0; live OLC slot; fresh Orca Task/Dispatch |
| S08-B | Governed memory, Context Packs, safe ingestion | `go/internal/memory/**`; `src/lib/sen-memory/**`; `src/app/api/sen/memory/**`; `qa/fixtures/sprint08/b/**`; `plans/reports/orchestrate-260826-sprint08-10/lane-b/**` | ACL-before-ranking, supersession, correction, deletion/export, stale-source, parser-cap, and FTS-fallback tests | Read-only privacy/determinism review; no shared-file edit | Contract revision 1.0.0; live OLC slot; fresh Orca Task/Dispatch |
| S08-C | Run Learning, forecast features, local candidate derivation | `go/internal/runlearning/**`; `src/lib/run-learning/**`; `src/app/api/sen/learning/**`; `qa/fixtures/sprint08/c/**`; `plans/reports/orchestrate-260826-sprint08-10/lane-c/**` | Terminal-run uniqueness, lineage, deterministic derivation, forbidden-field, idempotency, and rebuild tests | Read-only fixture/replay review; no shared-file edit | Contract revision 1.0.0; live OLC slot; fresh Orca Task/Dispatch |

Path comparison is case-insensitive and separator-normalized. These producer write sets have no intersection. A producer that needs any path outside its set must stop and hand a hash-pinned fragment to the integration writer.

## Single integration-writer boundary

Exactly one controller-designated integration writer owns all shared registration after producer lanes stop writing and their accepted bytes are hash-pinned:

- `go/internal/localdb/product/schema.go`
- `go/internal/localdb/community/migrations.go`
- `go/migrations/**`
- `src/lib/llmops/contracts.ts`
- every shared DTO barrel or generated contract artifact
- every common route registration or shared fixture index

The integration writer may register accepted fragments and exports only. It does not own producer implementation or feature redesign. No producer may edit these paths, and integration begins only after all three producer receipts are accepted.

## Global forbidden scope

All lanes and the integration writer are forbidden from changing `src/app/api/sen/chat/**`, enabling `SEN_CHAT_LEGACY_WRITER`, changing release/cutover flags, starting Phase 21, reopening Sprint 05-07 variants, or publishing/uploading community data in Sprint 08.

## Rollback boundary

Before shared registration, each lane is removable by excluding its owned modules and reserved migration fragment. After integration, rollback is forward-only: add a checksummed compensating migration, retain exact accepted producer hashes, and select the prior supported DTO/estimator/policy revision. Sparse or unsupported cohorts return `low confidence / out of distribution`; learning never lowers approval, review, privacy, capability, budget, WIP, or Orca execution gates.

## Gate decision

**HOLD producer dispatch.** The package freezes the coordination contract, but the following remain unresolved:

1. Promote the plan and phase files into the lane base revision.
2. Independently approve and hash-pin this package.
3. Run live OLC/provider/resource preflight and admit the required physical writers.
4. Create fresh lane-scoped Orca Tasks and Dispatches in separate worktrees.
5. Designate the single integration writer and record its immutable receipt.
6. Preserve the disabled legacy writer and blocked Phase 21 state.

Status: DONE_WITH_CONCERNS
