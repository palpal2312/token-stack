# S02-L3-005A — Final read-only producer review (Lane 1 + Lane 2)

**Lane 1 (core/product through S02-L1-006 freeze): GO.**
**Lane 2 (community through S02-L2-011 soak): NO-GO — 1 rule
(`L2-QUARANTINE-GUARD`).** Lane 2 `handoff/` excluded (active); review of
handoff/materializer deferred per instruction.

Basis: frozen AO-14/AO-15 (manifest pins verified), sprint map L69-75,
validation report 2026-08-24, prior lane-3 verdicts (S02-L3-002, -002B, -003).

## Quiescence and snapshot integrity

- Lane 1: scoped files untouched since 13:31 local (acknowledgement_test.go);
  zero writes during review. Current hashes match S02-L1-005/006 promotion
  manifests exactly.
- Lane 2: community files untouched since 13:20 local; zero writes during
  review; `handoff/` (active, excluded) untouched by any lane-3 action.
  Current hashes match S02-L2-010/011 frozen manifests exactly.
- Composite SHA-256 of scoped trees at review close: lane-1 `d489fc94…`,
  lane-2 community `38c4d88d…`.

Independent runs (read-only): lane-1 `go test -count=3 ./internal/localdb/
core/... ./internal/localdb/product/...` → **81/81 PASS**; vet clean.
Lane-2 `-count=3 ./internal/localdb/community/...` → **81/81 PASS**; vet
clean. No producer file edited.

## Lane 1 rule results

| Rule | Result | Evidence |
|---|---|---|
| L1-AO14-SCHEMA | PASS | 5 tables column/CHECK/index exact (S02-L3-002B) + additive v2 triggers; `sen-product.db` identity |
| L1-PRAGMAS-6 | PASS | WAL/FULL/FK/busy/cache_size/temp_store asserted live in conformance test |
| L1-RFC3339 | PASS | UTC ms `Z` layout + GLOB CHECKs; malformed rejected |
| L1-RECEIPTS-IDEMPOTENT | PASS | ON CONFLICT retry + full-field conflict read-back |
| L1-OUTBOX-REPLAY-RETENTION | PASS | Stable pending order; terminal-only bounded cleanup; restart replay |
| L1-CONTENTION-RESTART | PASS | Cross-handle busy_timeout wait test |
| L1-BACKUP-RESTORE | PASS | VACUUM INTO + integrity both sides + atomic publish |
| L1-PUBLISH-NO-OVERWRITE | PASS | **Prior L2 finding RESOLVED**: `moveNoReplace` hard-link claim — atomic no-replace on Windows/POSIX; race test `TestPublishFileConcurrentRaceHasOneWinner` |
| L1-QUARANTINE-SIDECARS | PASS | **Prior L1 finding RESOLVED**: exact `-wal`/`-shm` via Lstat, regular-file only, preflight all destinations, rollback on partial failure, no globbing; `TestQuarantineThenReopenStartsWithoutSidecars` |
| L1-ACK-TRANSITIONS | PASS | S02-L1-005: pending-only insert trigger, identity-immutable trigger, transition trigger (`pending→exported` w/ timestamp, `→failed/quarantined` w/o); API predicate on full identity + pending; terminal retry exact-match semantics; direct SQL cannot bypass |
| L1-TEST-VET | PASS | 81/81 independent, vet clean; receipt count=50 claim consistent |

## Lane 2 rule results

| Rule | Result | Evidence |
|---|---|---|
| L2-AO15-SCHEMA | PASS | **Prior NO-GO F1 RESOLVED**: migration 0005 copy/verify/swap to exact AO-15 — `status` CHECK exact 5-state vocabulary, `payload_hash UNIQUE`, `receipt_hash UNIQUE`, `published_to`/`metadata` present, `target_destination`/`completed_at`/`DEFAULT 1`, contract indexes `idx_contrib_hash`/`idx_contrib_status`/`idx_delivery_status`; legacy mapping documented |
| L2-PRAGMAS | PASS | RuntimeIntrospection asserts WAL/FULL/FK/busy on live DB |
| L2-RFC3339 | PASS | **Prior F2 RESOLVED**: `formatTimestamp` emits UTC RFC3339Nano text; persisted-precision test present |
| L2-SANITIZER-PRIVACY | PASS | **Prior F4 RESOLVED**: control-char scrub, raw-payload secret scan (Bearer/JWT/api-key/PEM), nested-JSON quarantine, 1024-byte bound, zero-leak `sanitized_payload` on quarantine, envelope redaction |
| L2-INGEST-IDEMPOTENCY | PASS | `IngestExportCandidate` dedupes by id and `payload_hash`; crash windows W1–W4 analyzed in S02-L2-008 and covered by async-ingestion/outage-isolation tests |
| L2-RECEIPTS-REMOVAL-WATERMARK | PASS | Receipt UNIQUE replay, removal reports, watermark restart tests green |
| L2-RESTART-CRASH | PASS | Reopen persistence + crash-replay suites; 50× soak claimed in S02-L2-011, consistent with independent 3× |
| L2-QUARANTINE-GUARD | **FAIL** | **Residual F3**: `Quarantine()` (sqlite_store.go:437) and `Tombstone()` (:651) are raw UPDATEs bypassing `ValidTransitions`. `StatusRejected` is terminal for `Transition()` but `Quarantine()` moves `rejected → quarantined`, and `quarantined → pending` is a legal transition — a tombstoned contribution can re-enter the queue. No resurrection regression test exists. **Remediation**: in `Quarantine()`, read current status and reject when `rejected` (or route through `Transition()`); optionally allow `quarantined → pending` only when never `sanitized`; add `TestQuarantineFromRejectedRejected` regression. |
| L2-TEST-VET | PASS | 81/81 independent (27 functions), vet clean |

## Notes

- Community backup/quarantine engine: shared `core.Backup`/`QuarantineCorrupt`
  from Lane 1 at master integration — verify wiring at promoted-master gate.
- Lane-2 legacy v2–v4 migrations remain for drift-detection continuity; final
  state after 0005 is AO-15 exact.
- Handoff package (`go/internal/localdb/handoff/`) excluded — active
  development; reviewed after producer JOB_DONE.

## Unresolved questions

- L2-QUARANTINE-GUARD fix ownership/ETA — Lane 2, then lane-3 re-check of
  that single rule.

JOB_DONE: S02-L3-005A. NEXT: review handoff/materializer after producer
JOB_DONE.
