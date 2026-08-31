# S03-L3-001 — Recovery / failure-injection matrix

Date: 2026-08-25. Lane: 3 (recovery evidence). Sprint: orchestrate-260825-sprint03-chat.

## Scope

Failure-injection matrix for durable SEN chat recovery (sessions, turns, attempts, sequenced events, command receipts, checkpoints). Matrix definition: `qa/fixtures/sprint03/recovery-matrix.json`. Contract basis: `qa/fixtures/sprint03/chat-contract.json` (reconstructed from Lane 2 `chat-client.ts` + proxy route; canonical Lane 1 store not landed at run time).

## Results

| Cell | Failure class | Evidence level | Status |
|---|---|---|---|
| FI-01 | crash-before-commit | fixture | PASS |
| FI-02 | crash-after-commit-before-ack | fixture | PASS |
| FI-03 | duplicate-command-retry | fixture | PASS |
| FI-04 | duplicate-event-delivery | fixture (real Lane 2 fn) | see S03-L3-003 |
| FI-05 | lost-event-gap | fixture (real Lane 2 fn) | see S03-L3-003 |
| FI-06 | wal-uncheckpointed-frames | fixture | PASS |
| FI-07 | inspection-sidecar-pollution | **live-promoted** | PASS |
| FI-08 | orphan-attempt-lease | fixture | PASS |
| FI-09 | concurrent-second-writer | fixture | PASS |
| FI-10 | canonical-store-unavailable | pending-lane1 | PENDING (static contract confirmed) |

Runnable cells: 7/7 PASS (6 by `failure-inject.py`, FI-07 by `sqlite-inspect.py` ×2 DBs). FI-04/FI-05 execute in the event runner against the real `mergeEventsBySeq`/`hasEventGap`.

## Key findings

1. Persist-before-ack + command-id replay holds on the contract-shaped store: retried command ids replay identical receipts; exactly one turn row per command id (FI-02/03).
2. Lease fencing by monotonically increasing generation rejects stale-owner writes with zero-row conditional updates (FI-08); second-writer injection surfaces `SQLITE_BUSY`, never silent interleave (FI-09).
3. Hot WAL (1,071,232 bytes uncheckpointed) copy-first inspection reads all 50/50 committed rows with `integrity_check=ok` (FI-06).
4. **Sprint 02 debt closed**: copy-first inspection of the real promoted DBs (`community-queue.db`, `sen-product.db`) changed zero source bytes and created zero new WAL/SHM sidecars (FI-07). The old gate inspection path polluted sidecars; this runner is the hygienic replacement.

## Artifacts

- Runner: `qa/fixtures/sprint03/failure-inject.py` (exit 0 = all runnable cells pass)
- Inspector: `qa/fixtures/sprint03/sqlite-inspect.py` (exit 0 = source untouched + copy readable)
- Evidence: `s03-l3-001-failure-inject-evidence.json`, `s03-l3-001-inspect-community-queue.json`, `s03-l3-001-inspect-sen-product.json` (this directory)

## Remaining concerns

- Fixture schema is reconstructed from the Lane 2 contract, not from Lane 1 DDL. When the canonical chat store lands, re-point FI-01..03/06/08/09 at it (cells already parameterized by DB path) and execute FI-10 as a runtime probe. **This is the remaining pending-lane1 integration.**
- FI-04/FI-05 are implemented in the event-evidence runner (S03-L3-003 scope) against the real Lane 2 `mergeEventsBySeq`/`hasEventGap`; not executed under this dispatch.
- S03-L3-002 (privacy/Orca-Gateway boundary audit), S03-L3-003 (latency/loss/duplicate runner) and S03-L3-004 (runbook/handoff updates) were descoped from this dispatch by controller decision (2026-08-25, coordinator message after six fixture cells passed). Recommend re-dispatch as fresh jobs; fixtures and matrix are already in place.
- No Lane 1/Lane 2 files were modified; runners consume their code read-only.

JOB_DONE: S03-L3-001
