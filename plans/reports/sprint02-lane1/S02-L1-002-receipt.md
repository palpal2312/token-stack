# S02-L1-002 Receipt

## Scope

Implemented local SQLite backup, restore, corruption classification, deterministic quarantine receipts, and adversarial migration durability tests in owned `core` and `product` packages.

No PostgreSQL, scheduler, Orca state, or legacy daemon code changed. No commit created.

## Delivered behavior

- `core.Backup` runs `PRAGMA integrity_check` before backup, snapshots through SQLite `VACUUM INTO` so committed WAL state is included, verifies the temporary snapshot, and publishes without overwriting an existing destination.
- `core.Restore` opens the backup read-only, checks integrity before copying, verifies the temporary restored database, and only publishes to a fresh destination.
- Failed backup and restore remove partial output and leave source/live database bytes untouched.
- `core.CorruptionError` and `core.IsCorruption` classify SQLite `CORRUPT` and `NOTADB` failures.
- `core.QuarantineCorrupt` moves corrupt bytes to deterministic `<database>.corrupt` and returns source, destination, reason, and UTC timestamp in `QuarantineReceipt`; existing quarantine data is never overwritten.
- Product wrappers expose verified backup, fresh-root restore, reopen, and quarantine operations for `product.db`.
- Tests prove migration checksum drift changes no schema, failed migration changes neither schema nor migration ledger, and both databases reopen correctly.

## Verification

Run from `go/`:

```text
go test -count=1 ./internal/localdb/core/... ./internal/localdb/product/...
ok   agentic-os/internal/localdb/core
ok   agentic-os/internal/localdb/product

# adversarial repeat
go test -count=10 ./internal/localdb/core/... ./internal/localdb/product/...
ok   agentic-os/internal/localdb/core
ok   agentic-os/internal/localdb/product

go vet ./internal/localdb/core/... ./internal/localdb/product/...
PASS (no output)

go build ./internal/localdb/...
PASS (no output)

git diff --check
PASS (line-ending warning for go/go.mod only)
```

Full `go build ./...` remains outside focused scope and blocked by pre-existing incomplete `cmd/sen-daemon` imports under `agentos.local/newsos/internal/...`.

## File SHA-256

```text
f12342e5a408417c1ee158aba663c30055a19491268f04c9b50fc32361e0307f  go/go.mod
60a5003ec0f1ba15d880e0d11a7d8158c86c1aec095d429bb48109568aa5a9ed  go/go.sum
67d247b1ff32989f904f1c72d784d0533508ba949298501fa879e442cab43838  go/internal/localdb/core/database.go
a53f55b48fe904140b22b4f0fe7a36c95c4cb39385b6a08e1f3832530c06c22a  go/internal/localdb/core/migration.go
00440df2b6c4e445fe58a0b31dfccc335142f473a003562e8aed16b947e8cd52  go/internal/localdb/core/backup.go
343025c90d6c9e5d48c437f343edcd10a8919a10477ecc89cd923709ce8d5ea1  go/internal/localdb/core/database_test.go
1c86df73793055302acdc9572a9d45206341dfd90b16fb8b62b970d97c05e3c6  go/internal/localdb/core/backup_test.go
fc4c18b6a257eff2893243da61e5252b42f122adea26e8ff736e2667f60fb6c1  go/internal/localdb/product/database.go
1c420a9651d67b5303a75cdb77e4c23e1249ed2edc7b3191ae1be037ef8592ed  go/internal/localdb/product/database_test.go
```

Receipt hash intentionally omitted from its own manifest.
