# S02-L2-008 Report: Cross-Contract Compatibility Review & Integration Architecture

## 1. Overview & Scope
- **Task ID**: S02-L2-008
- **Purpose**: Read-only cross-contract compatibility review comparing Lane 1 Product `ExportCandidate` / `ListPendingExportCandidates` API (`go/internal/localdb/product/store.go` in `source-sprint-02-lane-1`) with Lane 2 Community `IngestExportCandidate` (`go/internal/localdb/community/sqlite_store.go` & `store.go`).
- **Mode**: Read-only audit (no edits to Lane 1 or Lane 2 codebase).
- **Target Deliverables**:
  1. Exact field-by-field mapping between AO-14 Product and AO-15 Community models.
  2. Missing acknowledgement and status transition gap analysis.
  3. Crash windows, failure modes, and recovery behavior.
  4. Idempotency key hierarchy and conflict semantics.
  5. Minimal integration adapter acceptance tests specification.
  6. Quiescent verification of Lane 2 test suite and package file hashes.

---

## 2. Exact Field Mapping Analysis

| AO-14 Product `ExportCandidate` (`sen-product.db`) | Type / Format | AO-15 Community `ProductExportCandidate` (`community-queue.db`) | Target Column (`sanitized_contributions`) | Conversion / Compatibility Notes |
|---|---|---|---|---|
| `ID` | `string` (UUID / text) | `ID` | `id TEXT PRIMARY KEY` | Direct 1:1 mapping. Unique primary key across both boundaries. |
| `SourceType` | `string` (`"message"`, etc.) | `SourceType` | `source TEXT NOT NULL` | Defaults to `"sen-product.db"` in Lane 2 if empty. |
| `SourceID` | `string` (e.g. `"m1"`) | `SourceID` | Ingested into `raw_payload` JSON | Preserved inside structured `raw_payload` JSON object. |
| `ExportFormat` | `string` (`"json"`, etc.) | `ExportFormat` | Ingested into `raw_payload` JSON | Preserved inside `raw_payload` JSON object. |
| `ContentHash` | `string` (SHA-256 hex) | `ContentHash` | `payload_hash TEXT UNIQUE` | Direct 1:1 deduplication key. Lane 2 falls back to `sha256(RawPayload)` or `hash-{ID}` if empty. |
| `Status` | `string` (`"pending"`, `"exported"`, `"failed"`, `"quarantined"`) | `Status` | `status TEXT NOT NULL` | Lane 1 outbox status vs Lane 2 community ingestion status. Lane 2 checks allowlist / leak patterns to determine initial status (`pending` vs `quarantined`). |
| *(None / implicit)* | `string` (JSON) | `RawPayload` | `raw_payload TEXT NOT NULL` | Lane 1 stores candidates without payload; Lane 2 synthesizes or ingests payload string from source reference or metadata. |
| *(None / implicit)* | `map[string]string` | `Metadata` | `sanitized_payload TEXT` (JSON) | Clean metadata stored in `sanitized_payload` JSON column after sanitization pass. |
| `CreatedAt` | `time.Time` (`timestampLayout` = `2006-01-02T15:04:05.000Z`) | `CreatedAt` | `created_at TEXT NOT NULL` | Both packages format timestamps in UTC RFC3339 format with millisecond/nanosecond precision. |
| `ExportedAt` | `*time.Time` | `ExportedAt` | `processed_at TEXT` (on export/receipt) | `ExportedAt` is `NULL` when pending in L1; L2 sets `processed_at` upon processing, sanitizing, or quarantine. |

---

## 3. Missing Acknowledgement & Status Transition Analysis

### 3.1 The Acknowledgment Gap
1. **Current Lane 1 API Surface**:
   - `PutExportCandidate(ctx, db, candidate)`: Appends candidate with status `pending`.
   - `ListPendingExportCandidates(ctx, db, limit)`: Returns pending candidates ordered by `created_at, id`.
   - `CleanupExportCandidates(ctx, db, cutoff, limit)`: Purges terminal candidates (`exported`, `failed`, `quarantined`) older than cutoff.
   - **Gap Identified**: Lane 1 currently **lacks an explicit mutation/acknowledgement function** (such as `AcknowledgeExportCandidate(ctx, db, id, status, exportedAt)` or `MarkExportCandidateExported(ctx, db, id)`).
2. **Impact on Forward Pipeline**:
   - Because Lane 1 has no state transition method for `pending -> exported`, polled candidates returned by `ListPendingExportCandidates` remain in status `pending` indefinitely unless directly updated via custom SQL or until an `Acknowledge` function is added to Lane 1.
   - Ingesting a candidate into Lane 2 transitions the contribution to `pending` (or `quarantined`), but Lane 1 outbox remains unaware of the downstream delivery until L1 adds an acknowledge API.

### 3.2 Required Status Transitions
- **Happy Path**:
  1. Lane 1: `PutExportCandidate` (`status = 'pending'`).
  2. Adapter: `ListPendingExportCandidates` retrieves candidate.
  3. Lane 2: `IngestExportCandidate` inserts into `sanitized_contributions` (`status = 'pending'`).
  4. Lane 1 (Future): `AcknowledgeExportCandidate(ctx, db, id, "exported", now)` updates L1 record (`status = 'exported'`, `exported_at = now`).
- **Sanitization Quarantine Path**:
  1. Lane 1: Candidate has secret or disallowed meta.
  2. Lane 2: `IngestExportCandidate` flags violation, inserts into `sanitized_contributions` (`status = 'quarantined'`, `quarantine_reason = '...'`).
  3. Lane 1 (Future): Adapter calls `AcknowledgeExportCandidate(ctx, db, id, "quarantined", now)` (or `"failed"`).
- **Cleanup / Retention**:
  - Lane 1: `CleanupExportCandidates` cleans aged rows with `status IN ('exported', 'failed', 'quarantined')`.

---

## 4. Crash Windows & Resilience Analysis

1. **Window W1: Crash after L1 `PutExportCandidate` before L2 `IngestExportCandidate`**:
   - *State*: Candidate safely persisted in L1 SQLite WAL.
   - *Recovery*: Adapter restarts, calls `ListPendingExportCandidates`, replays candidate into L2. Safe.
2. **Window W2: Crash during L2 `IngestExportCandidate`**:
   - *State*: L2 SQLite transaction rollback guarantees zero partial writes.
   - *Recovery*: Re-read from L1 outbox and retry. Safe.
3. **Window W3: Crash after L2 `IngestExportCandidate` before L1 Acknowledgment**:
   - *State*: Candidate committed in L2 (`sanitized_contributions`), but still `pending` in L1 outbox.
   - *Recovery*: On adapter restart, L1 replays candidate. L2 `IngestExportCandidate` executes deduplication check by `ID` and `payload_hash`, returning existing record without re-insertion or conflict error. Adapter then successfully issues L1 acknowledgment. Safe.
4. **Window W4: Concurrent Ingestions**:
   - *State*: Multiple workers poll L1 and invoke L2 `IngestExportCandidate`.
   - *Recovery*: L2 SQLite unique index on `payload_hash` and primary key `id` handles race conditions gracefully; duplicate insert returns existing row (`getUnsafe`). Safe.

---

## 5. Idempotency Key Hierarchy & Conflict Semantics

1. **Primary Key Deduplication (`id`)**:
   - Checked first in `IngestExportCandidate`. If row with `candidate.ID` exists in `sanitized_contributions`, returns existing row immediately without error.
2. **Cryptographic Content Hash Deduplication (`payload_hash`)**:
   - If candidate has different ID but identical `ContentHash` / `payload_hash`, L2 identifies content collision and returns existing row. Prevents duplicate queued payloads from clogging review/delivery pipelines.
3. **Payload Immutability**:
   - Lane 1 `PutExportCandidate` rejects conflicting replays if fields differ for the same ID.
   - Lane 2 `IngestExportCandidate` guarantees deterministic hashing and safe return of existing records.

---

## 6. Minimal Integration Adapter Acceptance Test Specification

When Lane 1 adds `AcknowledgeExportCandidate`, the integration adapter must satisfy the following 5 acceptance criteria:

1. **Test 1: End-to-End Ingest & Acknowledge**:
   - *Given*: Product `ExportCandidate` in L1 `sen-product.db` with `status = 'pending'`.
   - *When*: Adapter reads via `ListPendingExportCandidates`, calls L2 `IngestExportCandidate`, and acknowledges L1.
   - *Then*: L2 `sanitized_contributions` has record with `status = 'pending'`, L1 candidate has `status = 'exported'`.
2. **Test 2: Crash Replay & Outbox Idempotency**:
   - *Given*: Candidate ingested in L2, but L1 acknowledge failed/crashed.
   - *When*: Adapter re-polls and re-ingests same candidate into L2.
   - *Then*: L2 returns existing record without error or duplicate insertion; L1 acknowledge succeeds.
3. **Test 3: Secret Detection & Quarantine Isolation**:
   - *Given*: Candidate with Bearer token in payload or disallowed key in metadata.
   - *When*: Ingested via adapter into L2.
   - *Then*: L2 stores contribution with `status = 'quarantined'`, quarantine reason populated; L2 `ListPending` excludes quarantined item; adapter updates L1 status to `quarantined`.
4. **Test 4: High-Concurrency Ingestion**:
   - *Given*: 50 concurrent goroutines pumping candidate records across L1 and L2.
   - *When*: Concurrent calls to `IngestExportCandidate`.
   - *Then*: No database locks, zero panics, no duplicate `payload_hash` rows.
5. **Test 5: Clean Outbox Retention**:
   - *Given*: Acknowledged terminal records in L1 older than cutoff.
   - *When*: L1 `CleanupExportCandidates` runs.
   - *Then*: Only terminal records removed; active/pending records untouched.

---

## 7. Package Verification & File Checksum Audit

All 8 files in `go/internal/localdb/community` verified quiescent with matching SHA-256 hashes:

| File Path | SHA-256 Hash |
|---|---|
| `go/internal/localdb/community/adversarial_test.go` | `9e006c100bdf93c3a001d8fc130103b39ceba2a0d5fe2a342293107159ce04be` |
| `go/internal/localdb/community/community_test.go` | `b3fec54c35e56d2b8f5d0a0c11d8ee0ed4f1a8554c5c8554f82e55b7753addd2` |
| `go/internal/localdb/community/export_envelope.go` | `baf0392afa3882ee10f45ce274a46982f4946d54fd2b5ede8151c833bdad517f` |
| `go/internal/localdb/community/migrations.go` | `d1cab61a22c6f5833d4d8ab481c0dbb7da5eb47f311ff5a3a5c1dac58eab468b` |
| `go/internal/localdb/community/sanitizer.go` | `cafe87e3440ef8a79df0d779e3ce7b1dc0521cbbd7faa076c113261a118c51da` |
| `go/internal/localdb/community/schema.go` | `6c5725c176a701db0b6074345a00fcf7a3772f226cf7ea9477f9bc1dd344a14c` |
| `go/internal/localdb/community/sqlite_store.go` | `acf10e107e7db864e29961f4321b9ba1bde574affe1124257d47d79d6e05952f` |
| `go/internal/localdb/community/store.go` | `f795f12a5e3567fd46cf2e8733bae53eda676d4f14b91612250b86f1fdc7603c` |

### Test Suite Execution
- Command: `go test -v -count=1 ./internal/localdb/community/...`
- Result: **23 PASS / 0 FAIL / 0 SKIP** (1.969s)
