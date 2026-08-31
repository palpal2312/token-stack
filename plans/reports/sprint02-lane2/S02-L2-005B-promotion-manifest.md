# S02-L2-005B Promotion Manifest & Pre-Registered Gate Audit

## 1. Owned Artifacts & Checksums (SHA-256)
- `go/internal/localdb/community/adversarial_test.go`: `6e022b39da168196f2f65809e1e1f3376bc26c4721d21125e2ebd6a02f1b1f2d`
- `go/internal/localdb/community/community_test.go`: `e885e5730f3930dae20f43c334fb2f0e129f6438a37e91528ab3d5c9e9a6b2aa`
- `go/internal/localdb/community/export_envelope.go`: `baf0392afa3882ee10f45ce274a46982f4946d54fd2b5ede8151c833bdad517f`
- `go/internal/localdb/community/migrations.go`: `d1cab61a22c6f5833d4d8ab481c0dbb7da5eb47f311ff5a3a5c1dac58eab468b`
- `go/internal/localdb/community/sanitizer.go`: `61f7016214043442f935931e6683b83b5809c8d30d506270f019e1c19cfbde6d`
- `go/internal/localdb/community/schema.go`: `66075b65c65947957ea4b3f68d95d0dded62a8268537ad79b4fe2a6008795bf1`
- `go/internal/localdb/community/sqlite_store.go`: `57123c9bb5b73c3bc10f980460532a623b3bb8378b66d7058976210bf0033b15`
- `go/internal/localdb/community/store.go`: `721d34ed70bbabeb24b54f80d797b87378cd5e7c886467afd41c394e1ab6ee57`

## 2. Dependency Delta (`go.mod` / `go.sum`)
- **Direct**: `modernc.org/sqlite v1.33.1` (pure Go, zero CGO requirement).
- **Transitive**: `github.com/dustin/go-humanize`, `github.com/google/uuid`, `github.com/hashicorp/golang-lru/v2`, `github.com/mattn/go-isatty`, `github.com/ncruces/go-strftime`, `github.com/remyoudompheng/bigfft`, `golang.org/x/sys`, `modernc.org/gc/v3`, `modernc.org/libc`, `modernc.org/mathutil`, `modernc.org/memory`, `modernc.org/strutil`, `modernc.org/token`.

## 3. Verified SQLite Contract Tables (AO-15)
1. `schema_migrations`
2. `community_queue_meta`
3. `sanitized_contributions`
4. `delivery_attempts`
5. `publication_receipts`
6. `removal_reports`
7. `sync_watermarks`

## 4. Focused Test Execution
```bash
cd go && rtk go test -v ./internal/localdb/community/...
```
**Results**: 18 passing tests across unit, concurrency, lifecycle, and adversarial suites.

## 5. Lane 3 Pre-Registered Gate Audit (`plans/scripts/sprint02-gate.ps1`)
Inspected read-only without mutating Lane 3:
- **DB File Resolution**: Gate looks for `community-queue.db` (matches).
- **PRAGMAs**: Validates `WAL`, `synchronous=FULL`, `foreign_keys=ON`, `busy_timeout <= 30000` (matches).
- **Table Names**: Requires all 6 core tables (matches).
- **Known Schema Differences between pre-registered gate template and final AO-15 spec**:
  1. *Index Names*: Gate script expects `idx_contrib_hash`, `idx_contrib_status`, `idx_delivery_status`. AO-15 migrations define `idx_sanitized_contrib_state`, `idx_sanitized_contrib_seq`, `idx_sanitized_contrib_plugin`, `idx_delivery_attempts_contrib`, etc.
  2. *Status column naming*: Gate script checks `sanitized_contributions.status` whereas AO-15 DDL names it `state` (`draft`, `queued`, `sanitizing`, `approved`, `exporting`, `exported`, `delivered`, `tombstoned`, `quarantined`).
  3. *Payload Hash*: Gate checks `sanitized_contributions.payload_hash`; AO-15 tracks immutable hash in `publication_receipts.receipt_hash` and `ExportEnvelope.Checksum`.

## 6. Integration Boundaries
- **Product DB Isolation**: `community-queue.db` is standalone and never opens `product.db` / `sen-product.db`.
- **Export Envelope**: Handoff passes sealed, typed `ExportEnvelope` structs only. Zero cross-file transactional coupling.
