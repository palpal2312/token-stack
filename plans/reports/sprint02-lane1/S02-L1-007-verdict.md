# S02-L1-007 Read-Only Lane2 Handoff / Materializer Verdict

## Status protocol

- 50%: reviewed `source-sprint-02-lane-2/go/internal/localdb/handoff` against bridge invariants; compared copied `core`/`product` digests to S02-L1-006 freeze.
- 80%: focused handoff tests, vet, and build passed; gate materializer produced exactly two checkpointed DB files.
- Blocker: none in reviewed handoff/materializer scope.
- Completion: **PASS**. Lane2 was not edited. Verdict written in Lane1 reports only.

## Verdict

**PASS** — sequential async bridge meets the checklist; copied Lane1 producer sources match the L1-006 freeze byte-for-byte.

Reviewed artifacts (Lane2, read-only):

```text
3fe889d56c8202ea81ea89b3a73d44ae5e8c6fdcdddd01d996b08fa4592eefe0  go/internal/localdb/handoff/adapter.go
ccc7575ff1e0149edbd733c87620d4bd2d83e3c8f192681bc25d39caec08cda7  go/internal/localdb/handoff/adapter_test.go
```

These match Lane2 S02-L2-014 promotion hashes.

## Checklist

| Check | Result | Evidence |
|---|---|---|
| No cross-DB transaction | PASS | `IngestAndAcknowledge` never calls `Begin`/`BeginTx`/`ATTACH`. Step 1 is community-only ingest; step 3 is product-only `AcknowledgeExportCandidate`. No shared `sql.Tx`. |
| Outage leaves pending | PASS | Closed community store returns error before ack; product row stays `pending` (`TestHandoff_QueueFailureLeavesProductPending`). |
| Crash replay / idempotency | PASS | Enqueue then close both DBs without product ack; reopen + replay reaches terminal `exported`; exact second call succeeds (`TestHandoff_CrashAfterEnqueueBeforeAckReplaysIdempotently`). Community ingest is ID/hash idempotent. |
| Ack mapping | PASS | Community `quarantined` → product `quarantined` with null `exported_at`. Non-quarantined durable queue result → product `exported` with UTC timestamp; replay preserves existing `exported_at`. |
| Concurrency | PASS | 20 concurrent `IngestAndAcknowledge` calls (mix accepted/quarantine) leave zero pending (`TestHandoff_ConcurrentCalls`). Community store mutex + product pending→terminal predicate. |
| Exactly two producer DBs / checkpoint | PASS | Distinct `sen-product.db` and `community-queue.db` (`TestHandoff_ExactlyTwoDBIdentities`). `TestMaterializeGateDatabases` opens via production APIs, runs `PRAGMA wal_checkpoint(TRUNCATE)`, closes cleanly. Live run left exactly those two files (69632 / 122880 bytes), no WAL/SHM. |

## Copied core/product vs S02-L1-006

All eleven `core` + `product` Go sources in Lane2 match the L1-006 canonical SHA-256 manifest exactly:

```text
0c116ed193885f4ba19c1764e95da2f62259a118191d5a180fb6abe700875fa6  core/backup.go
fd2442e6f5ffc17703c508418b9edd44588da38d09d29cfc0ebeb5da60bd1a1b  core/backup_test.go
2d62571856c98f335107c1400c12a4dd8d544724bcd611474a0572b7c6840fd2  core/database.go
343025c90d6c9e5d48c437f343edcd10a8919a10477ecc89cd923709ce8d5ea1  core/database_test.go
b005ca461e4595b7c8c947ecad37c348369f0f0df1a781c6141378624275c2a4  core/migration.go
5a30496ab7b7364bb34ff8972d464ad20b16953e1ee663c270eb37fe097adcbf  product/acknowledgement_test.go
2ca60dfde217b825fc5c86db3ba5f27ca5859806e5f7e6f2483fe64c601a7732  product/conformance_test.go
126c61c737e9329b95d4099ab00f569c5bd49aed9ef71293dc788107b230d9cb  product/database.go
2be2875edcc0be7f4506252686f201afbc623622dbf8bb64b84a8ed1914ce822  product/database_test.go
1f5c4629135d3de7b6071a39a4d7f2eebd4ad90c827039e7f70f4f2660a77cbd  product/schema.go
c33fd53de994c6259ad025c8a062aafd50693fd74d8c83ef3c23df8938be81ea  product/store.go
```

Note (non-blocking): Lane2 `go/go.mod` / `go/go.sum` differ from L1-006 (module graph / sqlite pin for community). That is outside the copied core/product source freeze and does not alter the matching producer package bytes.

## Verification (Lane2 worktree, read-only)

From `source-sprint-02-lane-2/go/`:

```text
go test -count=1 ./internal/localdb/handoff/...
ok   (7 tests)

go test -count=3 ./internal/localdb/handoff/...
ok   (21 executions)

go vet ./internal/localdb/handoff/...
PASS

go build ./internal/localdb/handoff/...
PASS

S02_GATE_DB_DIR=<temp> go test -count=1 -run TestMaterializeGateDatabases ./internal/localdb/handoff/
ok
# directory contained only: sen-product.db, community-queue.db
```

Lane2 tree was not modified by this review. No commit created.
