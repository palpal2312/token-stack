# S02-L3-001 — Pre-registered Sprint 02 gate

**Status: PRE-REGISTERED 2026-08-25, before any lane 1/2 SQLite output exists.**
Gate script: `plans/scripts/sprint02-gate.ps1`. Thresholds below are frozen now;
editing them after evidence exists invalidates the audit.

## Inputs

- `sprint-execution-map.md` lines 69–75 (Sprint 2 scope)
- `contracts/sprint01/sen-product-schema.md` (AO-14)
- `contracts/sprint01/community-queue-and-handoff.md` (AO-15)
- `reports/backend-database-validation-2026-08-24.md` (BD findings, confirmed decisions, retention)

## Execution

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File plans/scripts/sprint02-gate.ps1 `
    -SourceRoot <worktree-root> [-DbDir <dir>] [-OutJson result.json]
```

Searches `go/internal/localdb` first, then `go/`, then the source root (skips
`.git`, `node_modules`). Engine: Python ≥3 stdlib `sqlite3` (no sqlite3 CLI on
this host). Exit codes: `0 = GO`, `1 = NO-GO`, `2 = gate infrastructure error`.
Final line is machine-readable: `GATE: GO` or `GATE: NO-GO [RULE-CODE,...]`.

## Frozen rule table

Shared prefix: `SP` = sen-product.db, `CQ` = community-queue.db.

| Rule | Requirement | Source | Level |
|---|---|---|---|
| `*-FILE` | Database file exists and opens read-only | Map L71 | FAIL |
| `*-WAL` | `journal_mode = WAL` | Map L71, AO-14 §1 | FAIL |
| `*-SYNC-FULL` | `synchronous = FULL (2)` | Map L75, AO-14 §1, decision 3 | FAIL |
| `*-FK` | `foreign_keys = ON` | AO-14 §1, validation L62 | FAIL |
| `*-BUSY` | `0 < busy_timeout ≤ 30000` | AO-14 §1, validation L62 | FAIL |
| `*-TABLES` | Required tables present (below) | AO-14 §2, AO-15 §2, validation L90-97 | FAIL |
| `*-INDEXES` | Contract-pinned indexes present | AO-14 §2, AO-15 §2 | FAIL |
| `*-MIGRATIONS` | `schema_migrations` has ≥1 row | Map L71 | FAIL |
| `SP-AUDIT-OUTBOX` | Any `audit_*` or `*outbox*` table exists | Map L72 | FAIL |
| `SP-EXPORT-STATUS-CHECK` | `export_candidates.status` has `CHECK` | AO-14 §2 | FAIL |
| `SP-TS-RFC3339-CHECK` | Timestamp `CHECK` constraints | see contradiction below | WARN |
| `CQ-STATUS-CHECK-*` | `CHECK` on both queue status columns | AO-15 §2 | FAIL |
| `CQ-UNIQUE-PAYLOAD-HASH` | `payload_hash` UNIQUE | AO-15 §2 | FAIL |
| `CQ-UNIQUE-RECEIPT-HASH` | `receipt_hash` UNIQUE | AO-15 §2 | FAIL |
| `CQ-FK-DECL` | Queue FKs reference `sanitized_contributions` | AO-15 §2 | FAIL |
| `CQ-PRIVACY-SCAN` | No denylisted column names (prompt/token/secret/…) | BD-09 | WARN |

Required tables — `sen-product.db`: `schema_migrations`, `sen_messages`,
`run_refs`, `command_receipts`, `export_candidates`.
Required tables — `community-queue.db`: `schema_migrations`,
`sanitized_contributions`, `delivery_attempts`, `publication_receipts`,
`removal_reports`, `sync_watermarks` (last two: validation L90-97, job
S02-L2-003).
Required indexes: `idx_sen_messages_session`, `idx_run_refs_goal`,
`idx_export_status`; `idx_contrib_hash`, `idx_contrib_status`,
`idx_delivery_status`.

Verdict: `GO` iff zero FAIL. WARN never blocks.

## Contradictions resolved at pre-registration

1. **Timestamp `CHECK` constraints.** Validation report L64 wants RFC3339
   `CHECK`-validated timestamps; AO-14 pinned SQL carries no such `CHECK`
   (comments only). Failing lanes for contract-conformant SQL would be wrong;
   passing non-validated timestamps silently would hide the gap. Rule is WARN
   until the contracts are reconciled. Lanes may satisfy either side without
   changing the verdict.
2. **`removal_reports` / `sync_watermarks`.** Not in AO-15's SQL block but
   listed as core queue tables in validation L90-97 and owned by S02-L2-003.
   Kept as FAIL because the sprint map L73 handoff plus validation core-table
   list both predate lane work.

## Excluded clauses (untestable by a read-only static gate)

- **No-dual-write transaction ownership (BD-02).** Behavioral; needs runtime
  tracing, not schema inspection. Deferred to S02-L3-004 crash-replay gate.
- **Backup/restore and corruption quarantine proof (Map L71/L75).** Requires
  destructive runtime testing. S02-L3-004.
- **At-least-once delivery / idempotent replay (AO-15 §3).** Behavioral.
  S02-L3-004.
- **Performance targets (validation L256-268).** Acceptance hypotheses needing
  load harness. Not gated here.
- **Retention enforcement.** Requires time-travel data; out of scope for a
  schema gate.

## Self-test evidence (2026-08-25)

- Contract-conformant fixture pair → `GATE: GO`, exit 0 (25 checks, 1 WARN).
- Broken fixture (`journal_mode=DELETE`, `synchronous=NORMAL`, missing tables,
  missing `community-queue.db`) → `GATE: NO-GO [SP-WAL,SP-TABLES,SP-INDEXES,
  SP-AUDIT-OUTBOX,SP-EXPORT-STATUS-CHECK,CQ-FILE]`, exit 1.
- Fixtures were temporary and deleted after the run.

## Unresolved questions

- None.
