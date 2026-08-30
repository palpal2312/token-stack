# S02-L2-015 Receipt: Quarantine and Tombstone State-Machine Guard Enforcement & Manifest Realignment

## Status: COMPLETE / VERIFIED

- **Task ID**: S02-L2-015
- **Sprint / Lane**: Sprint 02 / Lane 2 (`sprint-02-lane-2`)
- **Components Hardened**:
  1. `community-queue` (`go/internal/localdb/community/`)
  2. `handoff-bridge` (`go/internal/localdb/handoff/`)
  3. `manifests & reports` (`plans/reports/sprint02-lane2/`)

---

## 1. Problem & Root Cause Analysis

1. **State Machine Bypass**:
   - `Quarantine` and `Transition` APIs previously allowed state overrides on terminal `rejected` items.
   - Memory store had a potential mismatch between `Status` (AO-15) and `State` (compatibility alias).
   - In-database state could theoretically be updated via raw SQL without DB-level constraint triggers preventing terminal status departures.

2. **Resolution & Invariants Implemented**:
   - **Terminal Guarding**: Contributions in `rejected` (terminal) status cannot transition to `quarantined`, `pending`, or any other status via memory store, SQLite store API, or SQLite DB triggers.
   - **Quarantine Idempotency**: Repeated `Quarantine` calls with identical violation code / reason succeed idempotently; incompatible reasons return an error.
   - **Pre-Terminal Valid Quarantine**: Valid pre-terminal quarantine (`pending`/`sanitizing`/`sanitized` -> `quarantined`) functions cleanly.
   - **State / Status Synchronization**: Memory store and SQLite store keep `item.Status` and `item.State` strictly aligned.
   - **DB Triggers**: Forward migration 6 (`0006_terminal_state_guard_triggers`) installs trigger `trg_prevent_rejected_transition` raising an abort on attempted updates away from `rejected`.
   - **Adversarial & Concurrency Test Coverage**: `TestSQLiteCommunityStore_TerminalStateGuards_QuarantineAndTombstone` and `TestCommunityQueue_QuarantineAndTombstoneStateGuards` verify API enforcement, DB trigger aborts, restart persistence, and concurrency.

---

## 2. Canonical Checksums: Lane 2-Owned Promotion

### 2.1 Community Queue (`go/internal/localdb/community`)
Composite AO-15 Hash: `03a29aaefb6b1e063ebbfa9b05444103dfeea8f04e579cc0773e7970fe8a0109`

| File | SHA-256 Checksum |
|---|---|
| `adversarial_test.go` | `2d1ab1242e358321dafa5380dde1b1f7ceac999c8eed905a2ed3fbedbb61aca7` |
| `community_test.go` | `64090203c79e522a0f962193da280d3c43b8b21462094bf2255161784cd9cc7e` |
| `export_envelope.go` | `baf0392afa3882ee10f45ce274a46982f4946d54fd2b5ede8151c833bdad517f` |
| `migrations.go` | `2b5a4ad98a6db31e0a8e84e004acba71eef1e60daea2acc86478c942c6730236` |
| `sanitizer.go` | `6ce96f5c7837cadf2c8825fdd477a67655b3ee39d585f1b81b851879f2cc57df` |
| `schema.go` | `6c5725c176a701db0b6074345a00fcf7a3772f226cf7ea9477f9bc1dd344a14c` |
| `sqlite_store.go` | `8a9e276337e18fe7fdfc19b8a2016522da6596884aae580c5869924bb7b82c70` |
| `store.go` | `533c15bad7acad409936d02f1d6cb6d46b34d7a5db3521d42eab3f54e59b6494` |

### 2.2 Handoff Adapter (`go/internal/localdb/handoff`)

| File | SHA-256 Checksum |
|---|---|
| `adapter.go` | `3fe889d56c8202ea81ea89b3a73d44ae5e8c6fdcdddd01d996b08fa4592eefe0` |
| `adapter_test.go` | `ccc7575ff1e0149edbd733c87620d4bd2d83e3c8f192681bc25d39caec08cda7` |

---

## 3. Staged Inputs from Lane 1 (Read-Only)

| Package | File | SHA-256 Checksum | Classification |
|---|---|---|---|
| `core` | `backup.go` | `0c116ed193885f4ba19c1764e95da2f62259a118191d5a180fb6abe700875fa6` | Staging input |
| `core` | `backup_test.go` | `fd2442e6f5ffc17703c508418b9edd44588da38d09d29cfc0ebeb5da60bd1a1b` | Staging input |
| `core` | `database.go` | `2d62571856c98f335107c1400c12a4dd8d544724bcd611474a0572b7c6840fd2` | Staging input |
| `core` | `database_test.go` | `343025c90d6c9e5d48c437f343edcd10a8919a10477ecc89cd923709ce8d5ea1` | Staging input |
| `core` | `migration.go` | `b005ca461e4595b7c8c947ecad37c348369f0f0df1a781c6141378624275c2a4` | Staging input |
| `product` | `acknowledgement_test.go` | `5a30496ab7b7364bb34ff8972d464ad20b16953e1ee663c270eb37fe097adcbf` | Staging input |
| `product` | `conformance_test.go` | `2ca60dfde217b825fc5c86db3ba5f27ca5859806e5f7e6f2483fe64c601a7732` | Staging input |
| `product` | `database.go` | `126c61c737e9329b95d4099ab00f569c5bd49aed9ef71293dc788107b230d9cb` | Staging input |
| `product` | `database_test.go` | `2be2875edcc0be7f4506252686f201afbc623622dbf8bb64b84a8ed1914ce822` | Staging input |
| `product` | `schema.go` | `1f5c4629135d3de7b6071a39a4d7f2eebd4ad90c827039e7f70f4f2660a77cbd` | Staging input |
| `product` | `store.go` | `c33fd53de994c6259ad025c8a062aafd50693fd74d8c83ef3c23df8938be81ea` | Staging input |

---

## 4. Verification Suite Results

1. **Soak Test Execution (`go test -count=10 ./internal/localdb/...`)**:
   - 630/630 test executions passed cleanly (100% pass rate across 63 tests).
2. **Go Toolchain Checks**:
   - `go vet ./internal/localdb/...`: 0 issues.
   - `go build ./internal/localdb/...`: 0 errors.
3. **Producer DB Materialization**:
   - `TestMaterializeGateDatabases` cleanly generates `sen-product.db` (69,632 bytes) and `community-queue.db` (122,880 bytes).
