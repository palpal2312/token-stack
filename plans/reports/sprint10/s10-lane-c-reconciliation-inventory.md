# S10 Lane C reconciliation inventory

## Scope and method

This is a redacted, offline inventory from the isolated Lane C worktree. It
does not inspect Orca, processes, a daemon, lease service, backend, outbox, or
snapshot store, and is not a GO/NO-GO verdict. Missing live authority is
reported as `NOT_MEASURABLE`, never inferred from files.

Observed ref: `aadaf6e` before this Lane C producer commit. The unrelated
untracked `pnpm-lock.yaml` was present before Lane C work and is excluded.

## Evidence inventory

| Area | Evidence | Offline status | Limit / controller action |
|---|---|---|---|
| Lane A | `f2bd04e:plans/reports/sprint10/s10-lane-a-evaluation-receipt.md` | DEMONSTRATED (receipt claim) | Recompute its pins and rerun focused test from promoted current bytes. |
| Lane B | `b81bf64:plans/reports/sprint10/s10-lane-b-controlled-delivery-receipt.md` | DEMONSTRATED (receipt claim) | Recompute its pins and rerun focused test from promoted current bytes. |
| Lane C | `s10-lane-c-recovery-drill.ts`, focused test, runbook | DEMONSTRATED (offline model only) | The test covers six fail-closed/replay classifications; it is not a live drill. |
| Daemon crash / restore | Hash-pinned replay classifications | NOT_MEASURABLE | Requires separately authorized daemon and restore evidence. |
| Duplicate outbox | Duplicate-suppression classification | NOT_MEASURABLE | Requires separately authorized durable outbox evidence. |
| Stale lease | Fail-closed classification | NOT_MEASURABLE | Requires separately authorized lease/controller evidence. |
| Backend unavailable | `not-measurable` classification | NOT_MEASURABLE | Requires separately authorized backend-health evidence. |
| Invalid snapshot | Fail-closed classification | NOT_MEASURABLE | Requires separately authorized snapshot validation/restore evidence. |
| Legacy writer / Phase 21 | Existing S10 receipts state disabled/blocked | NOT_MEASURABLE | Controller must perform current control reconciliation; Lane C made no control changes. |
| Arbiter / release / cutover | No S10 arbiter artifact in this worktree | MISSING | Independent arbiter only after complete current-byte packet; no release/cutover here. |

## Lane C current-byte pins

```text
DE17EE4C1515653E2BF09C3D394D4ABFC356E954666BCF531A0ABDAB84E1DA08 src/lib/llmops/s10-lane-c-recovery-drill.ts
B226DF9EDB38E72AF439DAEC11B2A6E0D9517E0DBBB5317D0D57930C5597F224 qa/tests/s10-lane-c-recovery-drill.test.ts
3D78B93FDD98A4C570AFD8BF070053F18791AF759B2EC0702209E67F51107237 docs/runbooks/s10-lane-c-offline-recovery.md
```

## Validation

`npx --no-install tsx --test qa/tests/s10-lane-c-recovery-drill.test.ts`
passed: 4 tests, 0 failures. `npx --no-install tsc --noEmit` completed with no
diagnostics in this worktree.

JOB_DONE: Lane C offline reconciliation inventory completed; all live recovery and closure claims remain NOT_MEASURABLE.
