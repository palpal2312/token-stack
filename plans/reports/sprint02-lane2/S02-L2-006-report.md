# S02-L2-006 Schema Conformance & Audit Verification Report

## Status
- **Task ID**: S02-L2-006 Complete
- **Package**: `go/internal/localdb/community`
- **Contract**: Frozen AO-15 (`contracts/sprint01/community-queue-and-handoff.md`)
- **Result**: ALL 20 UNIT, LIFECYCLE, CONCURRENCY, AND ADVERSARIAL TESTS PASSING

---

## 1. Exact AO-15 Schema Conformance Verification

### 1.1 Column Names & Check Constraints
1. **`sanitized_contributions`**:
   - `id TEXT PRIMARY KEY`
   - `source TEXT NOT NULL`
   - `payload_hash TEXT NOT NULL UNIQUE`
   - `raw_payload JSON NOT NULL`
   - `sanitized_payload JSON`
   - `status TEXT NOT NULL CHECK(status IN ('pending', 'sanitizing', 'sanitized', 'quarantined', 'rejected'))`
   - `quarantine_reason TEXT`
   - `created_at TEXT NOT NULL` (RFC3339 / RFC3339Nano UTC)
   - `processed_at TEXT` (RFC3339 / RFC3339Nano UTC)

2. **`delivery_attempts`**:
   - `id TEXT PRIMARY KEY`
   - `contribution_id TEXT NOT NULL REFERENCES sanitized_contributions(id) ON DELETE CASCADE`
   - `target_destination TEXT NOT NULL`
   - `attempt_number INTEGER NOT NULL DEFAULT 1`
   - `status TEXT NOT NULL CHECK(status IN ('enqueued', 'sending', 'succeeded', 'failed', 'quarantined'))`
   - `error TEXT`
   - `created_at TEXT NOT NULL`
   - `completed_at TEXT`

3. **`publication_receipts`**:
   - `id TEXT PRIMARY KEY`
   - `contribution_id TEXT NOT NULL REFERENCES sanitized_contributions(id) ON DELETE CASCADE`
   - `receipt_hash TEXT NOT NULL UNIQUE`
   - `published_to TEXT NOT NULL`
   - `metadata JSON`
   - `published_at TEXT NOT NULL`

### 1.2 Exact Indexes
- `idx_contrib_hash ON sanitized_contributions(payload_hash)`
- `idx_contrib_status ON sanitized_contributions(status)`
- `idx_delivery_status ON delivery_attempts(status)`

---

## 2. Migration 0005 Upgrade Behavior
Migration `0005_ao15_exact_schema_conformance` safely upgrades older schemas:
- Copies legacy `sanitized_contributions` records mapping `state -> status` (`draft/queued -> pending`, `sanitizing -> sanitizing`, `approved/exporting/exported/delivered -> sanitized`, `quarantined -> quarantined`, `tombstoned -> rejected`).
- Synthesizes `payload_hash` from record data and converts metadata to `raw_payload` JSON.
- Creates exact AO-15 table structures and recreates exact named indexes.

---

## 3. Package File Checksums (SHA-256)
- `go/internal/localdb/community/adversarial_test.go`: `6e022b39da168196f2f65809e1e1f3376bc26c4721d21125e2ebd6a02f1b1f2d`
- `go/internal/localdb/community/community_test.go`: `e885e5730f3930dae20f43c334fb2f0e129f6438a37e91528ab3d5c9e9a6b2aa`
- `go/internal/localdb/community/export_envelope.go`: `baf0392afa3882ee10f45ce274a46982f4946d54fd2b5ede8151c833bdad517f`
- `go/internal/localdb/community/migrations.go`: `d1cab61a22c6f5833d4d8ab481c0dbb7da5eb47f311ff5a3a5c1dac58eab468b`
- `go/internal/localdb/community/sanitizer.go`: `61f7016214043442f935931e6683b83b5809c8d30d506270f019e1c19cfbde6d`
- `go/internal/localdb/community/schema.go`: `66075b65c65947957ea4b3f68d95d0dded62a8268537ad79b4fe2a6008795bf1`
- `go/internal/localdb/community/sqlite_store.go`: `57123c9bb5b73c3bc10f980460532a623b3bb8378b66d7058976210bf0033b15`
- `go/internal/localdb/community/store.go`: `721d34ed70bbabeb24b54f80d797b87378cd5e7c886467afd41c394e1ab6ee57`

---

## 4. Verification Command
```bash
cd go && rtk go test -v ./internal/localdb/community/...
```
All 20 tests pass.
