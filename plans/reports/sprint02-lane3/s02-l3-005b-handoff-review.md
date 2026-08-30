# S02-L3-005B — Independent review: Lane 2 handoff/materializer (S02-L2-012/013/014)

**Verdict: GO.** All contract-level rules PASS. Three INFO findings; no FAIL.

Scope: `go/internal/localdb/handoff/` + receipts S02-L2-012/013/014. Lane-2
`community/` excluded except public-API assumptions (S02-L2-015 remediation
active); its changing files were not re-reviewed. No producer edits.

Basis: BD-02 cross-DB handoff (validation report 2026-08-24), frozen
AO-14/AO-15, sprint map L73.

## Snapshot

Handoff files quiet ~26 min at review start; zero drift across review
(post-test rehash identical). Hashes match S02-L2-014 promotion manifest:

| File | SHA-256 |
|---|---|
| adapter.go | `3fe889d56c8202ea81ea89b3a73d44ae5e8c6fdcdddd01d996b08fa4592eefe0` |
| adapter_test.go | `ccc7575ff1e0149edbd733c87620d4bd2d83e3c8f192681bc25d39caec08cda7` |

Independent run: `go test -count=3 ./internal/localdb/handoff/...` →
**21/21 PASS** (7 suites × 3); `go vet` clean. Community non-test files
untouched for >30 min before compile; community not otherwise exercised.

## Rule results

| Rule | Result | Evidence |
|---|---|---|
| H-NO-CROSS-DB-TX | PASS | Sequential isolated ops; `IngestAndAcknowledge` holds no transaction across DBs (code-verified); comment invariants match implementation |
| H-OUTAGE-PENDING | PASS | Queue failure returns before ack; `TestHandoff_QueueFailureLeavesProductPending` proves candidate stays `pending` and re-lists |
| H-CRASH-REPLAY-IDEMPOTENT | PASS | Crash after enqueue before ack: restart → replay dedupes via id/`payload_hash`, ack preserves existing `exported_at` so exact-retry succeeds; second exact replay also succeeds (adapter_test.go:204-285) |
| H-ACK-MAPPING | PASS (note I2) | Quarantined → ack `quarantined` (null `exported_at`, matches L1-005 trigger); accepted → ack `exported` (UTC); trigger-level rules honored |
| H-CONCURRENCY | PASS | 20-way mixed clean/secret concurrent bridge calls, zero errors, all terminal, none pending |
| H-PRODUCTION-APIS | PASS | Bridge and materializer use only `product.Open/PutMessage/PutCommandReceipt/PutExportCandidate/ListPendingExportCandidates/AcknowledgeExportCandidate` and community store public APIs; single read-only SELECT for `exported_at` preservation (AO-14-pinned shape) |
| H-MATERIALIZER-CLEAN | PASS | `S02_GATE_DB_DIR` empty-dir guard; exactly two DB identities via production Open APIs; evidence rows across all AO-14/15 tables; `wal_checkpoint(TRUNCATE)` + clean close; file existence asserted |
| H-NO-FIXTURE-AS-LIVE | PASS | Materializer generates real evidence through production write paths in a caller-supplied dir; no synthetic fixture labeled live; skip-gated without env var |
| H-TEST-VET | PASS | 21/21 independent, vet clean; receipt soak claims (610/610) consistent |

## Findings (all INFO, none blocking)

### I1 — Batch abort on first error

`ProcessPendingBridge` returns at the first candidate error, leaving later
pending candidates for the next pass. Sanitize-class failures do not error
(in-store quarantine), so the abort class is DB errors and ack identity
conflicts — conservative and self-healing on retry. No contract breach
(AO-15 "bad payload cannot block later contributions" is honored at store
level). Optional hardening: collect per-candidate errors and continue.

### I2 — Ack-exported mapping breadth

Any non-quarantined community status (incl. `pending`) acks product
`exported`. Coherent under BD-02 ("candidate records copied/blocked status":
exported = copied), but a stricter mapping (ack only on durable
pending/sanitized, error otherwise) would surface unexpected states.

### I3 — S02-L2-013 receipt hash table misaligned

Rows pair filenames to the wrong hashes (e.g. `adapter.go` listed with
`product/schema.go`'s hash). S02-L2-014 manifest is correct and matches the
files; cosmetic receipt defect only.

## Public-API assumptions (for S02-L2-015 remediation)

Handoff depends on `community.OpenSQLiteCommunityStore`,
`IngestExportCandidate` signature, `StatusQuarantined` semantics, and store
type `SQLiteCommunityStore`. L2-015 must keep these stable or re-freeze
handoff (L2-014 hashes cover current pairing).

## Unresolved questions

- None.

JOB_DONE: S02-L3-005B. NEXT: rereview L2-015 remediation, then
promoted-master gate run.
