# S02-L3-003 — Independent review: Lane 2 community queue

**Verdict: NO-GO on pinned AO-15 conformance (finding F1). Engineering quality otherwise PASS.**

Review basis: pinned AO-15 = `contracts/sprint01/community-queue-and-handoff.md`,
sha256 `69ED2EBE…CA95` (matches `ratification-manifest.json` pin; verified
2026-08-25). Plus sprint-execution-map L69-75 and validation report
`backend-database-validation-2026-08-24.md`.

## Reviewed snapshot

Lane 2 was actively writing when review started (first hash 2026-08-25T05:03:37Z;
`adversarial_test.go` changed mid-review). Waited for ≥90 s quiesce per job
instruction, then re-hashed and re-ran tests on the final snapshot below
(05:10:29Z, stable). All findings reference this snapshot.

SHA-256, `go/internal/localdb/community/`:

| File | Hash |
|---|---|
| adversarial_test.go | `1ec67f99fd7f9ec73a88634688cd7d9fb98e600dd64a6650c61d05522397fc88` |
| community_test.go | `e885e5730f3930dae20f43c334fb2f0e129f6438a37e91528ab3d5c9e9a6b2aa` |
| export_envelope.go | `baf0392afa3882ee10f45ce274a46982f4946d54fd2b5ede8151c833bdad517f` |
| migrations.go | `457510002d115c60282e067b9f253def5de1111d7fd1299bc88d759d687c8e6e` |
| sanitizer.go | `61f7016214043442f935931e6683b83b5809c8d30d506270f019e1c19cfbde6d` |
| schema.go | `54a5c1c00a234049a8732ae96895f4b1c1ebb67f49c3671f0c522d288f81acd0` |
| sqlite_store.go | `95ca178ccbf2b89347d6e291c544210d7fb512792286d88df01b1b80cbc074d0` |
| store.go | `721d34ed70bbabeb24b54f80d797b87378cd5e7c886467afd41c394e1ab6ee57` |

Receipts reviewed: S02-L2-001 (`0cf2b1df…`), S02-L2-002 (`30f1f6aa…`),
S02-L2-003, S02-L2-004, S02-L2-005B, S02-L2-005C (hashes drifted during
concurrent writes; content as of 05:10:29Z).

Independent verification run (read-only, lane-3 worktree shell):
`go test ./internal/localdb/community/` → **19/19 PASS** (go1.26.4,
modernc.org/sqlite v1.33.1); `go vet` clean. No lane-2 file modified.

## PASS axes

| Axis | Result | Evidence |
|---|---|---|
| Real SQLite pragmas | PASS | DSN `_pragma` + explicit `PRAGMA` exec; `RuntimeIntrospection` test asserts wal / synchronous=2 / fk=1 / busy=5000 on live DB |
| Migrations + checksum drift | PASS | 4 checksummed forward migrations, transactional apply; tampered checksum aborts init (`MigrationDriftDetection`) |
| Sanitizer forbidden fields | PASS (note F4) | Strict key allowlist; Bearer/JWT/api-key/PEM regex; 1024-byte bound; 5 adversarial cases rejected in tests |
| Deterministic hash / idempotency | PASS (note F1) | Envelope checksum over canonical JSON (Go map keys sorted); duplicate-ID enqueue: exactly 1/20 concurrent success |
| No dual DB open | PASS | Zero `sen-product` references in package; single `sql.Open`; envelope-only handoff |
| No execution semantics | PASS | No scheduler/orca/attempt-execution concepts; `delivery_attempts` is AO-15 §2 delivery handoff, not execution tracking |
| Reopen / crash / quarantine | PASS (notes F3, F5) | Reopen-persistence, watermark resume (`seq > last_seq` → items 4,5), crash-replay test; quarantine exclusion from `ListPending` |
| Focused tests | PASS | 19 tests green on independent rerun |

## FAIL findings

### F1 — HIGH: schema deviates from pinned AO-15 contract

Lane 2 receipt 005B §5 acknowledges the divergence but reframes pinned AO-15
as a "pre-registered gate template" and self-declares its DDL "final AO-15
spec". No re-ratified contract artifact exists; the Sprint 1 manifest still
pins the original file. Implementation cannot unilaterally amend a ratified
contract.

Concrete deviations (`migrations.go` vs pinned AO-15 §2):

- `sanitized_contributions`: missing `source`, `payload_hash UNIQUE`,
  `raw_payload`, `sanitized_payload`, `processed_at`; `status` renamed to
  `state`; 9-state enum vs contract 5-state
  (`pending|sanitizing|sanitized|quarantined|rejected`); no `CHECK`.
- `delivery_attempts`: `target_destination` renamed `target_endpoint`;
  `created_at`/`completed_at` replaced by `attempted_at`; no status `CHECK`
  (`enqueued|sending|succeeded|failed|quarantined`); `attempt_number` missing
  `DEFAULT 1`.
- `publication_receipts`: `receipt_hash` not `UNIQUE` (contract requires);
  missing `published_to` and `metadata` columns.
- Contract index names absent: `idx_contrib_hash`, `idx_contrib_status`,
  `idx_delivery_status`.
- `schema_migrations.version` INTEGER vs contract TEXT.

**Remediation (pick one, controller decision):**
(a) Conform DDL to pinned AO-15: add/rename columns above, add `CHECK`
constraints, `UNIQUE(receipt_hash)`, contract index names — additive
migration 0005 possible for most renames; or
(b) Route an AO-15 amendment through controller re-ratification with a new
manifest hash; lane 3 then re-pins the gate. Until either lands, pre-registered
gate fails this DB with `CQ-INDEXES`, `CQ-STATUS-CHECK-SANITIZED`,
`CQ-UNIQUE-PAYLOAD-HASH`, `CQ-UNIQUE-RECEIPT-HASH`.

### F2 — MEDIUM: timestamps not RFC3339

DSN has no `_time_format`, so modernc.org/sqlite writes `time.Time.String()`
(`2026-08-25 05:03:21.7629099 +0000 UTC`); DDL defaults use
`CURRENT_TIMESTAMP` (`YYYY-MM-DD HH:MM:SS`). Pinned contract format is
RFC3339 UTC (`2026-08-25T03:45:00.000Z`). String-level cross-boundary
comparisons (handoff hash, receipts) break.

**Remediation:** bind timestamps as `t.UTC().Format(time.RFC3339)` strings;
remove `CURRENT_TIMESTAMP` defaults from DDL; add a stored-format
round-trip test asserting `T`/`Z` shape.

### F3 — MEDIUM: Quarantine/Tombstone bypass the state machine

`Transition()` validates `ValidTransitions`, but `Quarantine()` and
`Tombstone()` are raw UPDATEs: `tombstoned → quarantined → queued`
resurrects a removed contribution (`ValidTransitions` allows
`quarantined → queued`). Defeats removal terminality — privacy axis.

**Remediation:** guard both methods with current-state checks (reject any
transition out of `tombstoned`; allow `quarantined → queued` only before
`exported`); add a resurrection regression test on the SQLite store.

### F4 — LOW: unscanned unbounded outbound text fields

Sanitizer covers only `Metadata`. `title`, `author_ref`, `plugin_slug`,
`version`, `quarantine_reason` accept unbounded unscanned text — a secret or
raw prompt in `title` ships to the community DB (BD-09 spirit).

**Remediation:** length bounds + same secret-pattern scan on all outbound
text fields; reject unknown-structure items at `Enqueue`.

### F5 — LOW: quarantine isolation proven only on memory store

`TestCommunityQueue_QuarantineIsolation` uses `MemoryCommunityStore`; the
SQLite path is covered only implicitly by the lifecycle test.

**Remediation:** port the isolation test to `SQLiteCommunityStore`
(quarantine item 2 of 3, assert `ListPending` excludes it and others export).

### F6 — INFO: receipt drift

S02-L2-002 names `TestSQLiteCommunityStore_QuarantineIsolationAndRemovalReports`
— not present in snapshot. L2-004/005B hash manifests pin the pre-introspection
`adversarial_test.go` (`fdec42e1…`); final is `1ec67f99…`.

**Remediation:** refresh receipts to final snapshot hashes (005C already
correct).

## Notes

- Pre-registered gate (`plans/scripts/sprint02-gate.ps1`) stands unchanged; it
  encodes pinned AO-15, verified against the manifest hash. Lane 2's
  characterization of it as a drifted "template" is inverted.
- FALLBACK (self-audit of gate script) not triggered: primary review completed.
- NEXT: S02-L3-002 product review, after Lane 1 marker.

## Unresolved questions

- F1 path (conform vs amend) is a controller decision; gate stays pinned until
  then.
