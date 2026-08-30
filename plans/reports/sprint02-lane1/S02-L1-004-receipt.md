# S02-L1-004 Receipt

## Status protocol

- 50%: Lane3 S02-L3-002 LOW findings reproduced and threat boundaries enumerated.
- 80%: exact SQLite sidecar quarantine and cross-platform no-overwrite publication implemented; deterministic race, collision, unrelated-file, and reopen tests passed.
- Blocker: none in focused scope.
- Completion: focused suite passed 50 consecutive runs; vet, build, and diff check passed.

## Finding dispositions

### L1 — quarantine leaves `-wal` / `-shm`: RESOLVED

`QuarantineCorrupt` now:

- accepts only a regular main database file;
- discovers only exact sibling paths `<db>-wal` and `<db>-shm` with `Lstat`;
- rejects non-regular sidecars;
- preflights every deterministic destination before moving any file;
- moves main DB and present sidecars to `<source>.corrupt` without overwriting;
- returns quarantined sidecars in deterministic WAL-then-SHM receipt order;
- rolls previously moved files back if a later move fails;
- never globs or touches similarly named files such as `<db>-wal-unrelated` or sibling `<db>2-wal`;
- proves fresh reopen after quarantine cannot replay stale sidecars.

### L2 — placeholder swap window: RESOLVED

`publishFile` no longer creates, closes, then overwrites a placeholder. It now uses an atomic same-filesystem hard-link claim:

1. `os.Link(source, destination)` creates destination only if absent on Windows and POSIX.
2. Existing or concurrently created destination makes the link fail without changing either file.
3. After successful claim, source link is removed. If source cleanup fails, the published destination remains; code never deletes a path that an external actor could have replaced.

Backup and restore temporary files are siblings of destinations, satisfying same-filesystem scope. This is an atomic no-replace publication boundary, not a check-then-rename approximation.

## Preserved behavior

- AO-14 exact schema, indexes, CHECK vocabularies, UTC RFC3339 timestamps, and six effective pragmas.
- S02-L1-002 WAL-consistent backup, integrity checks, fresh-path restore, checksum drift, failed migration rollback, reopen, and corruption classification.
- S02-L1-003 idempotent command receipts/export candidates, pending replay, safe retention, restart, and busy-timeout contention.
- No community, Lane3, master, PostgreSQL, scheduler, or Orca state changes.

## Deterministic tests added

- `TestPublishFileNeverOverwritesHealthyDestination`
- `TestPublishFileConcurrentRaceHasOneWinner`
- `TestQuarantineCorruptMovesExactSidecarsOnly`
- `TestQuarantineThenReopenStartsWithoutSidecars`
- `TestQuarantineSidecarCollisionMovesNothing`

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

Repository-wide `go test ./...`, `go vet ./...`, and `go build ./...` were also attempted. They remain blocked by pre-existing out-of-scope `cmd/sen-daemon` imports for absent `agentos.local/newsos/internal/...` packages and undefined legacy `projections.Checkpoint`. Focused owned packages compile, vet, and test cleanly; these unrelated packages were not changed.

Repository-wide `go test ./...`, `go vet ./...`, and `go build ./...` were also attempted. They remain blocked by pre-existing out-of-scope `cmd/sen-daemon` imports for absent `agentos.local/newsos/internal/...` packages and undefined legacy `projections.Checkpoint`. Focused owned packages compile, vet, and test cleanly; these unrelated packages were not changed.

## Promotion SHA-256

```text
f12342e5a408417c1ee158aba663c30055a19491268f04c9b50fc32361e0307f  go/go.mod
60a5003ec0f1ba15d880e0d11a7d8158c86c1aec095d429bb48109568aa5a9ed  go/go.sum
0c116ed193885f4ba19c1764e95da2f62259a118191d5a180fb6abe700875fa6  go/internal/localdb/core/backup.go
fd2442e6f5ffc17703c508418b9edd44588da38d09d29cfc0ebeb5da60bd1a1b  go/internal/localdb/core/backup_test.go
2d62571856c98f335107c1400c12a4dd8d544724bcd611474a0572b7c6840fd2  go/internal/localdb/core/database.go
343025c90d6c9e5d48c437f343edcd10a8919a10477ecc89cd923709ce8d5ea1  go/internal/localdb/core/database_test.go
b005ca461e4595b7c8c947ecad37c348369f0f0df1a781c6141378624275c2a4  go/internal/localdb/core/migration.go
178ba3faff6d0daa0a05fbe291924aff7c32ef1ffc8efddee277cfe6216ec4cb  go/internal/localdb/product/conformance_test.go
126c61c737e9329b95d4099ab00f569c5bd49aed9ef71293dc788107b230d9cb  go/internal/localdb/product/database.go
2be2875edcc0be7f4506252686f201afbc623622dbf8bb64b84a8ed1914ce822  go/internal/localdb/product/database_test.go
95babafa95b9eed760f465dda38bfc30b54fd2e1da4aaf76d7d3acf7630b7c71  go/internal/localdb/product/schema.go
511c82a80cb23eebe734d51549e326824018d2a6bd1743eca55e4a9f976962dd  go/internal/localdb/product/store.go
```

Receipt hash intentionally omitted from its own manifest. No commit created.
