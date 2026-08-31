# S02-L3-004B — Controller-authorized gate corrections (G1 + six-pragma pin)

**Status: APPLIED 2026-08-25.** Corrections to the S02-L3-004A pre-registered
gate, authorized by controller from frozen evidence (S02-L3-002B finding G1
and I1). No existing check weakened; one rule broadened by accept-path, one
rule added.

## Corrections

### 1. SP-AUDIT-OUTBOX — broadened accept (G1)

Old: PASS only when a table named `audit_*` or `*outbox*` exists — unpassable
by any AO-14-conformant schema (AO-14 pins `command_receipts` +
`export_candidates` and no `audit_*` name).

New: PASS when (a) `audit_*`/`*outbox*` table exists, **or** (b) AO-14 pair
`command_receipts` (append-only audit) + `export_candidates` (durable
outbox) is present (map L72 semantics). FAIL otherwise, with detail naming
the missing pair.

### 2. SP-CACHE-TEMP — added (AO-14 §1 six-pragma freeze)

AO-14 freezes `cache_size=-64000` and `temp_store=MEMORY` alongside the four
already gated. **Evidence-form constraint:** both pragmas are per-connection
and never persisted in the DB file (same class as `foreign_keys`;
`journal_mode` is the only file-persisted pragma of the six), so a fresh
gate connection cannot observe producer runtime values. Rule asserts static
source evidence: `cache_size(-64000)`/`cache_size = -64000` and
`temp_store(MEMORY)`/`temp_store = MEMORY`/`= 2` in localdb non-test `.go`
sources; runtime effectiveness is covered live by SC-PRODUCER-TESTS (lane
conformance suites assert all six against open connections).

Known limitation (pre-existing, documented not fixed): `SP-FK`/`CQ-FK` read
`foreign_keys` after the gate itself sets it — tautological; runtime FK
proof rides on SC-PRODUCER-TESTS. Recorded for the next controller-authorized
gate revision.

## Fixture changes (rebuilt)

- GO tree: added `core/database.go` fixture evidence carrying the six-pragma
  DSN (labeled FIXTURE EVIDENCE ONLY).
- NO-GO tree: dropped `command_receipts` (keeps SP-AUDIT-OUTBOX falsifiable),
  no pragma-source evidence (SP-CACHE-TEMP fails).
- Builder now checkpoints (`wal_checkpoint(TRUNCATE)`) and removes
  `-wal`/`-shm` sidecars.

## Proof runs (2026-08-25)

| Run | Result | Exit |
|---|---|---|
| GO fixture, `-RunScenarios` | `GATE: GO`; SP-AUDIT-OUTBOX PASS via `audit_events` accept; SP-CACHE-TEMP PASS | 0 |
| GO variant with `audit_events` dropped | SP-AUDIT-OUTBOX PASS via `command_receipts + export_candidates` pair accept; `GATE: GO` | 0 |
| NO-GO fixture, `-RunScenarios` | `GATE: NO-GO [SP-WAL,SP-TABLES,SP-AUDIT-OUTBOX,SP-EXPORT-STATUS-CHECK,CQ-WAL,CQ-TABLES,CQ-STATUS-CHECK-SANITIZED,CQ-STATUS-CHECK-DELIVERY,CQ-UNIQUE-PAYLOAD-HASH,CQ-UNIQUE-RECEIPT-HASH,XG-DB-INVENTORY,XG-NO-PG,XG-SANITIZER-SOURCE,SP-CACHE-TEMP,XG-PRODUCT-STANDALONE,SC-CRASH-REPLAY,SC-RECEIPT-UNIQUE]` (17 codes) | 1 |
| Bad `-SourceRoot` | `GATE-ERROR` stderr | 2 |
| Lane-1 real tree (static probe) | SP-CACHE-TEMP PASS on producer `core/database.go` (`cache_size(-64000)`, `temp_store(MEMORY)` present) | n/a |

## Hashes (post-correction)

| File | SHA-256 |
|---|---|
| sprint02-gate.ps1 | `7c8d81803266e3b468f24a2e1177de75a2b1b06a5dd834ebc3db7539a662dcfc` |
| build-gate-fixtures.ps1 | `3642fcca0f8e8e7393d44d14bd54105d34085b80594757f3e4e87fcf90a1ace8` |
| fixtures/go sen-product.db | `a06b454cf5acbc0ebba3699d2a8986c8d783f9d05f0d14cf4ead954000e83731` |
| fixtures/go community-queue.db | `6a06e2c31cd9f6ed608fda9272837a59acca26c809789602b8e6475ef8771c3d` |
| fixtures/go sanitizer.go | `4a13f155efbdc9fcc1ba5c2e6a3987b13dc721e6c13e3e9d6fe47bd50ca8cfa1` |
| fixtures/go core/database.go | `96077abd4460a5045f06385ae51350e5dd09e0eb0fad8ab71af0d8d2dd7e6eca` |
| fixtures/nogo sen-product.db | `323a5474fee3cb0f062639917bbae530c3005b7d231f3126fae6ab751b24cd36` |
| fixtures/nogo community-queue.db | `a828a7e6643c61e89004566c9122a35bd652d66412bcd297396f81da42d8d3db` |
| fixtures/nogo extra-metrics.db | `02336a3a1f0a4945439cdf329e4d04622afec28c973dddb635fd2af06ff0f155` |
| fixtures/nogo sanitizer.go | `7ad1c0877d012dc72547d2fedfa731316b6f497169ae14e06e878c635cf40b49` |
| fixtures/nogo store.go | `cbf7feedbaeb0052e19ab68c3312671770f0be7916042bd8986b663ce7f0a5c2` |

Note: gate runs recreate SQLite-managed `-shm`/`-wal` sidecars next to
inspected live WAL databases (read-only opens still allocate the wal-index);
gate never writes DB content. Fixture sidecars cleaned after proof runs.

## Unresolved questions

- SP-FK/CQ-FK tautology fix queued for next controller-authorized revision.

JOB_DONE: S02-L3-004B. NEXT: final producer review (S02-L1-004,
S02-L2-006/007) after producer JOB_DONE, then promoted-master gate run.
