# S02-L1-005 Receipt

## Status protocol

- 50%: product outbox contract mapped across creation, acknowledgement, crash replay, concurrency, restart, direct SQL, and invalid inputs.
- 80%: acknowledgement API, migration triggers, and deterministic tests passed; all prior focused gates remained green.
- Blocker: none in focused scope.
- Completion: focused suite passed 50 consecutive runs; vet, build, and diff check passed.

## Delivered API

```go
func AcknowledgeExportCandidate(ctx context.Context, db *sql.DB, acknowledgement ExportAcknowledgement) error
```

`ExportAcknowledgement` carries candidate ID, source type/ID, format, content hash, terminal status, and optional `ExportedAt`. It deliberately excludes `CreatedAt`: acknowledgement cannot rewrite candidate creation identity.

## Semantics

- Creation is pending-only through `PutExportCandidate`; terminal creation and pending-with-`exported_at` are rejected.
- Allowed transitions are exactly:
  - `pending -> exported` with mandatory explicit timestamp;
  - `pending -> failed` with null timestamp;
  - `pending -> quarantined` with null timestamp.
- Terminal-to-pending and terminal-to-terminal transitions reject.
- Exact terminal retry succeeds, including UTC-normalized millisecond RFC3339 `exported_at`.
- Different terminal status, timestamp, source type, source ID, format, or content hash rejects.
- Missing candidate, invalid/non-terminal status, invalid timestamp rules, nil DB, and canceled context reject.
- Update predicate includes immutable identity/content fields and pending state; only `status` and `exported_at` mutate.
- Migration v2 adds database triggers so direct SQL cannot mutate identity/content/created fields or bypass transition/timestamp rules.
- Concurrent different acknowledgements through separate SQLite handles produce one successful terminal transition; loser observes and reports conflict.

## Crash-window replay proof

Test sequence:

1. Product commits stable pending candidate ID/content hash.
2. Simulated community enqueue succeeds idempotently.
3. Process closes before product acknowledgement.
4. Restart replays pending candidate.
5. Community enqueue retry with same ID/hash succeeds idempotently.
6. Product acknowledgement commits terminal `exported`.
7. Restart and exact acknowledgement retry succeed; candidate no longer appears pending.

No cross-database transaction, community package import, or community file mutation was introduced.

## Preserved behavior

- AO-14 exact public columns/indexes/CHECK vocabularies and six effective pragmas.
- S02-L1-002 backup/restore, checksummed migration drift, rollback, integrity, reopen, and corruption handling.
- S02-L1-003 receipts/outbox idempotency, retention, restart/replay, and busy-timeout contention.
- S02-L1-004 exact WAL/SHM quarantine and atomic no-replace publication.

## Tests added

- `TestAcknowledgeExportCandidateTransitionsAndRetries`
- `TestAcknowledgeExportCandidateRejectsInvalidAndConflictingRequests`
- `TestAcknowledgeExportCandidateConcurrentWriters`
- `TestAcknowledgeExportCandidateCrashWindowAndRestartReplay`
- `TestPutExportCandidateRequiresPendingWithoutExportedAt`
- `TestExportCandidateTriggersPreventDirectMutation`

## Verification

Run from `go/`:

```text
go test -count=50 ./internal/localdb/core/... ./internal/localdb/product/...
ok   agentic-os/internal/localdb/core
ok   agentic-os/internal/localdb/product

go vet ./internal/localdb/core/... ./internal/localdb/product/...
PASS (no output)

go build ./internal/localdb/...
PASS (no output)

git diff --check
PASS (go.mod line-ending warning only)
```

Repository-wide `go test ./...`, `go vet ./...`, and `go build ./...` remain blocked by pre-existing out-of-scope `cmd/sen-daemon` imports for absent `agentos.local/newsos/internal/...` packages and undefined legacy `projections.Checkpoint`, as recorded in S02-L1-004. Focused owned packages compile, vet, and test cleanly; unrelated packages were not changed.

## Promotion SHA-256

```text
f12342e5a408417c1ee158aba663c30055a19491268f04c9b50fc32361e0307f  go/go.mod
60a5003ec0f1ba15d880e0d11a7d8158c86c1aec095d429bb48109568aa5a9ed  go/go.sum
0c116ed193885f4ba19c1764e95da2f62259a118191d5a180fb6abe700875fa6  go/internal/localdb/core/backup.go
fd2442e6f5ffc17703c508418b9edd44588da38d09d29cfc0ebeb5da60bd1a1b  go/internal/localdb/core/backup_test.go
2d62571856c98f335107c1400c12a4dd8d544724bcd611474a0572b7c6840fd2  go/internal/localdb/core/database.go
343025c90d6c9e5d48c437f343edcd10a8919a10477ecc89cd923709ce8d5ea1  go/internal/localdb/core/database_test.go
b005ca461e4595b7c8c947ecad37c348369f0f0df1a781c6141378624275c2a4  go/internal/localdb/core/migration.go
5a30496ab7b7364bb34ff8972d464ad20b16953e1ee663c270eb37fe097adcbf  go/internal/localdb/product/acknowledgement_test.go
2ca60dfde217b825fc5c86db3ba5f27ca5859806e5f7e6f2483fe64c601a7732  go/internal/localdb/product/conformance_test.go
126c61c737e9329b95d4099ab00f569c5bd49aed9ef71293dc788107b230d9cb  go/internal/localdb/product/database.go
2be2875edcc0be7f4506252686f201afbc623622dbf8bb64b84a8ed1914ce822  go/internal/localdb/product/database_test.go
1f5c4629135d3de7b6071a39a4d7f2eebd4ad90c827039e7f70f4f2660a77cbd  go/internal/localdb/product/schema.go
c33fd53de994c6259ad025c8a062aafd50693fd74d8c83ef3c23df8938be81ea  go/internal/localdb/product/store.go
```

Receipt hash intentionally omitted from its own manifest. No commit created.
