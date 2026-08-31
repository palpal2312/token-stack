# S02-L2-007 Receipt: Async AO-14 Export-Candidate Ingestion & Safety Verification

## Status
- **Task ID**: S02-L2-007 Complete
- **Package**: `go/internal/localdb/community`
- **Contracts**: Frozen AO-14 Candidate Ingestion & Frozen AO-15 Queue Schema (`contracts/sprint01/community-queue-and-handoff.md`)
- **Verification Result**: ALL 23 UNIT, LIFECYCLE, CONCURRENCY, AND ADVERSARIAL TESTS PASSING

---

## 1. Features Implemented in S02-L2-007

### 1.1 Async Export-Candidate Ingestion (`IngestExportCandidate`)
- **No Plugin/Author Requirement**: Implemented `IngestExportCandidate(ctx, ProductExportCandidate)` on `SQLiteCommunityStore` and `MemoryCommunityStore`. Supports flexible product payloads without requiring `plugin_slug` or `author_ref`.
- **Idempotent Replay**: Deduplicates repeated candidate submissions by candidate ID or by cryptographic content hash (`payload_hash`). Re-ingestion returns the existing record cleanly without mutation or error.
- **Sanitize & Quarantine Handling**: Validates raw payloads and metadata against leak patterns (JWT, Bearer, API keys, PEM private keys) and strict metadata allowlist. Flagged candidates transition to `status = 'quarantined'` with detailed violation reasons, without disrupting or halting the pending queue.
- **Queue-Outage Isolation**: Rejection and outage errors are strictly isolated from callers and upstream producers. Recovered databases cleanly resume ingestion and replay without data loss or corruption.
- **Persistence & Check Constraints**: Retains RFC3339 text timestamps, single-writer WAL mode, foreign key cascades, and exact AO-15 CHECK constraints.

---

## 2. Package File Checksums (SHA-256)
- `go/internal/localdb/community/adversarial_test.go`: `9e006c100bdf93c3a001d8fc130103b39ceba2a0d5fe2a342293107159ce04be`
- `go/internal/localdb/community/community_test.go`: `b3fec54c35e56d2b8f5d0a0c11d8ee0ed4f1a8554c5c8554f82e55b7753addd2`
- `go/internal/localdb/community/export_envelope.go`: `baf0392afa3882ee10f45ce274a46982f4946d54fd2b5ede8151c833bdad517f`
- `go/internal/localdb/community/migrations.go`: `d1cab61a22c6f5833d4d8ab481c0dbb7da5eb47f311ff5a3a5c1dac58eab468b`
- `go/internal/localdb/community/sanitizer.go`: `cafe87e3440ef8a79df0d779e3ce7b1dc0521cbbd7faa076c113261a118c51da`
- `go/internal/localdb/community/schema.go`: `6c5725c176a701db0b6074345a00fcf7a3772f226cf7ea9477f9bc1dd344a14c`
- `go/internal/localdb/community/sqlite_store.go`: `acf10e107e7db864e29961f4321b9ba1bde574affe1124257d47d79d6e05952f`
- `go/internal/localdb/community/store.go`: `f795f12a5e3567fd46cf2e8733bae53eda676d4f14b91612250b86f1fdc7603c`

---

## 3. Verification Commands
```bash
cd go && rtk go test -v ./internal/localdb/community/...
cd go && rtk go vet ./internal/localdb/community/...
```
**Results**:
- 23 test suites pass across in-memory and SQLite-backed stores.
- `go vet` clean.
- No other lane/master edits made; no commits created.
