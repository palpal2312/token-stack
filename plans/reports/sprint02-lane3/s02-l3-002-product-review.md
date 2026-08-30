# S02-L3-002 — Independent review: Lane 1 backup/restore/corruption (S02-L1-002)

**Verdict: PASS with 2 LOW findings.** Implementation is sound; findings are
hardening items, not blockers.

Basis: sprint-execution-map L71/L75 (WAL, `synchronous=FULL`, migration,
backup/restore, corruption quarantine), validation report
`backend-database-validation-2026-08-24.md` L62-68, S02-L1-002 receipt.

## Reviewed snapshot

Files quiescent ~7 min before review (newest write 05:20:19Z, review
05:27:11Z); receipt is the newest file and its manifest hashes match the
snapshot exactly. SHA-256, lane-1 worktree:

| File | Hash |
|---|---|
| core/backup.go | `00440df2b6c4e445fe58a0b31dfccc335142f473a003562e8aed16b947e8cd52` |
| core/backup_test.go | `1c86df73793055302acdc9572a9d45206341dfd90b16fb8b62b970d97c05e3c6` |
| core/database.go | `67d247b1ff32989f904f1c72d784d0533508ba949298501fa879e442cab43838` |
| core/database_test.go | `343025c90d6c9e5d48c437f343edcd10a8919a10477ecc89cd923709ce8d5ea1` |
| core/migration.go | `a53f55b48fe904140b22b4f0fe7a36c95c4cb39385b6a08e1f3832530c06c22a` |
| product/database.go | `fc4c18b6a257eff2893243da61e5252b42f122adea26e8ff736e2667f60fb6c1` |
| product/database_test.go | `1c420a9651d67b5303a75cdb77e4c23e1249ed2edc7b3191ae1be037ef8592ed` |
| S02-L1-002-receipt.md | `157b693e3e367155a3c0d149115e66480b0a16fc1ba86b688fdd8730324cedb9` |

Independent runs from lane-1 `go/` (no producer file touched):
`go test -count=1 ./internal/localdb/core/... ./internal/localdb/product/...`
→ **12/12 PASS**; `go test -count=5 ./internal/localdb/core/...` → 40/40;
`go vet` clean. Host is Windows 11, so tests double as Windows verification.

## Axis results

| Axis | Result | Evidence |
|---|---|---|
| WAL-consistent backup | PASS | `VACUUM INTO` snapshot after source `integrity_check`; test restores committed-WAL row |
| No overwrite of healthy destination | PASS | `os.Stat` refusal + `O_EXCL` placeholder in `publishFile`; tests: existing-destination backup refused, healthy restore target untouched |
| Integrity before/after | PASS | Backup: source check + snapshot re-open read-only + check before publish. Restore: backup check pre-copy + restored temp check pre-publish |
| Atomic restore | PASS | `.partial` temp in same directory (same volume), deferred cleanup on error, publish by rename only after verification; tests assert no destination/partial residue on failure |
| Corruption quarantine receipt | PASS (note L1) | Deterministic `<path>.corrupt`, collision refusal, receipt carries source/dest/reason/UTC time; `CorruptionError`/`IsCorruption` classify SQLITE_CORRUPT(11)/NOTADB(26) incl. masked extended codes |
| Original unchanged on failure | PASS | Tests prove live DB readable after failed backup and healthy destination intact after refused restore |
| Windows behavior | PASS | `filepath` + `ToSlash` + quote-escaped `VACUUM INTO` literal; placeholder-then-rename valid under Go/Windows `MoveFileEx`; all tests green on Windows host |
| Race handling | PASS (note L2) | `O_EXCL` publish, quarantine-collision refusal, transactional idempotent migrations, duplicate-version/invalid-migration rejection, checksum-drift abort with no schema change |
| Focused tests / vet | PASS | 12 tests incl. rollback-no-leak, drift-no-change, reopen-after-failure; vet clean; receipt `-count=10` claim consistent with my `-count=5` run |

## Findings

### L1 — LOW: quarantine leaves `-wal`/`-shm` sidecars

`QuarantineCorrupt` renames only the main DB file. A stale `product.db-wal`/
`product.db-shm` remains beside the path where a fresh `product.db` will be
created. Salt/checksum mismatches make SQLite ignore orphaned frames, so risk
is low, but a fresh open against leftover sidecars is an avoidable edge.

**Remediation:** rename (or delete) `<path>-wal` and `<path>-shm` alongside
the main file; add a reopen-after-quarantine test.

### L2 — LOW: publish placeholder swap window

`publishFile` closes the `O_EXCL` placeholder, then renames over it. An
external actor could theoretically swap the destination between close and
rename. Single-writer local design makes this theoretical only.

**Remediation:** optional — document the assumption, or re-stat destination
immediately before rename and abort on change.

## Notes (no action)

- `IntegrityCheck` on every `product.Open` is correct for foundation stage;
  on large DBs full `integrity_check` may exceed the 50 ms p95 open budget —
  revisit with `quick_check` when DB size grows.
- "Backup-gated migrations" (validation L68) not yet exercised: current
  migrations are additive only, no destructive rebuild. Gate the first
  destructive migration on a verified backup when it arrives.
- Restore-to-fresh-path + quarantine-removes-original compose into a coherent
  recovery flow: quarantine corrupt file, then `Restore` publishes at the
  vacated path.
- FALLBACK check: lane-3 gate unchanged — it already asserts frozen `status`
  CHECK and `idx_contrib_hash`/`idx_contrib_status`/`idx_delivery_status`;
  thresholds stay strict. Controller-upheld AO-15 NO-GO stands; Lane 2
  rereview waits for JOB_DONE S02-L2-006.

## Unresolved questions

- None.

JOB_DONE: S02-L3-002. NEXT: independent rereview of Lane 2 after
JOB_DONE S02-L2-006.
