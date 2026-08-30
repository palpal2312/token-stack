# S02-L3-002B — Addendum: Lane 1 S02-L1-003 AO-14 product schema/store review

**Verdict: PASS (AO-14 conformant).** One gate-side finding (G1) needs a
controller decision before the promoted-master gate run.

Scope: `go/internal/localdb/product/**`, `core/{database,migration,database_test}.go`.
Excluded per instruction: `core/backup.go`, `core/backup_test.go` (S02-L1-004
owned, actively edited at review start — hashes recorded, content not reviewed).

## Reviewed snapshot

Receipt manifest hashes match scoped snapshot exactly (verified 2026-08-25T06:07Z);
re-hash after test run identical (no drift during review).

| File | Hash |
|---|---|
| product/schema.go | `95babafa95b9eed760f465dda38bfc30b54fd2e1da4aaf76d7d3acf7630b7c71` |
| product/store.go | `511c82a80cb23eebe734d51549e326824018d2a6bd1743eca55e4a9f976962dd` |
| product/database.go | `126c61c737e9329b95d4099ab00f569c5bd49aed9ef71293dc788107b230d9cb` |
| product/conformance_test.go | `178ba3faff6d0daa0a05fbe291924aff7c32ef1ffc8efddee277cfe6216ec4cb` |
| product/database_test.go | `2be2875edcc0be7f4506252686f201afbc623622dbf8bb64b84a8ed1914ce822` |
| core/database.go | `2d62571856c98f335107c1400c12a4dd8d544724bcd611474a0572b7c6840fd2` |
| core/migration.go | `b005ca461e4595b7c8c947ecad37c348369f0f0df1a781c6141378624275c2a4` |
| core/database_test.go | `343025c90d6c9e5d48c437f343edcd10a8919a10477ecc89cd923709ce8d5ea1` |
| S02-L1-003-receipt.md | `29c005a3db70b0debd1aabe6a4c68143db433a71a5c2304416dba901cf08d073` |

Independent runs (read-only, lane-1 `go/`): `go test -count=3
./internal/localdb/product/...` → **24/24 PASS**; `go vet` clean. Product
package run does not compile `core/*_test.go`, so no race with active
S02-L1-004 edits; post-run rehash confirms zero file change.

## Axis results

| Axis | Result | Evidence |
|---|---|---|
| Exact AO-14 tables/columns | PASS | All 5 tables column-exact; `schema_migrations(version TEXT PK, applied_at)` kept exact by splitting checksum metadata into additive `schema_migration_checksums` |
| CHECK constraints | PASS | `role IN ('user','assistant','system')`; export `status IN ('pending','exported','failed','quarantined')`; rejection tests for `tool`/`copying` |
| Contract indexes | PASS | `idx_sen_messages_session`, `idx_run_refs_goal`, `idx_export_status` exact names |
| Pragmas | PASS | Full AO-14 §1 six: WAL, FULL, FK ON, busy_timeout 5000, cache_size −64000, temp_store MEMORY — all asserted live in `TestAO14SchemaPragmasAndChecks` |
| RFC3339 | PASS | `2006-01-02T15:04:05.000Z` UTC layout; GLOB CHECKs incl. `IS NULL OR` nullable pattern; stored value `2026-08-25T11:05:06.123Z` from −0700 input; malformed rejected. Resolves the SP-TS-RFC3339-CHECK contradiction on the strict side |
| Idempotent immutable receipts | PASS | `ON CONFLICT DO NOTHING` + full-field read-back; identical retry succeeds, conflicting command/candidate ID errors; replay after close/open |
| Export outbox replay/retention | PASS (note I2) | Pending list stable `(created_at, id)` order + limit; cleanup deletes terminal-only rows older than cutoff, bounded; pending survives restart |
| Contention/restart | PASS | Two independent handles; writer blocks within busy_timeout then succeeds after commit (100 ms hold); restart replay of receipts + pending candidates |
| DB identity | PASS | `DatabaseName = "sen-product.db"` — matches frozen gate XG-DB-INVENTORY identity (filename fixed since S02-L3-002 review) |

## Findings

### G1 — MEDIUM (gate-side, controller decision): SP-AUDIT-OUTBOX too narrow

Pre-registered rule requires a table named `audit_*` or `*outbox*` (proxy for
sprint map L72 "append-only audit/outbox"). Lane 1 satisfies L72 semantically
with `command_receipts` (append-only audit) + `export_candidates` (durable
outbox) — AO-14-pinned names, so no `audit_*`/`*outbox*` table will ever
exist in a conformant build. The gate would FAIL a conformant schema.

**Recommendation:** controller-approved gate correction before the
promoted-master run: SP-AUDIT-OUTBOX passes when `command_receipts` AND
`export_candidates` are present (append-only audit + outbox roles), keeping
the `audit_*`/`*outbox*` pattern as an additional accept. Pre-registration
discipline: not editing the rule unilaterally post-evidence.

### I1 — INFO: cache_size/temp_store not gate-asserted

AO-14 §1 pins six pragmas; pre-registered gate asserts four (WAL/FULL/FK/
busy). Producer implements and tests all six. No post-evidence rule addition
per pre-registration discipline; controller may pin the extra two in a gate
revision.

### I2 — INFO: pending-candidate expiry out of cleanup scope

`CleanupExportCandidates` removes terminal rows only. Retention policy
(validation L296: pending/retry rows expire at 90 days) has no API here.
Plausibly intentional for this layer; policy owner to confirm.

### I3 — INFO: additive `schema_migration_checksums` table

Sixth table beyond AO-14's pinned five; `version TEXT PK REFERENCES
schema_migrations(version) ON DELETE RESTRICT`, preserves S02-L1-002 drift
detection. Contract pins the five public tables and does not forbid internal
additives. No violation.

## Unresolved questions

- G1 gate correction and I1 pragma pinning await controller ruling.

JOB_DONE: S02-L3-002B. NEXT: after producer JOB_DONE — final
hash/quiescence review of S02-L1-004 and S02-L2-006/007.
