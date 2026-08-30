# S02-L3-004A — Pre-registered integrated crash/replay/privacy gate

> **Amended by S02-L3-004B (2026-08-25, controller-authorized):**
> SP-AUDIT-OUTBOX broadened to accept the AO-14
> `command_receipts`+`export_candidates` pair; SP-CACHE-TEMP added (AO-14
> six-pragma freeze, static source evidence). See
> `s02-l3-004b-gate-corrections.md` for rule text, proofs and current hashes.
>
> **Amended by S02-L3-004C (2026-08-25, controller-authorized):**
> tautological SP-FK/CQ-FK retired; FK evidence chain is now XG-FK-SOURCE
> (static) + SC-FK-ENFORCED (live) + widened SC-PRODUCER-TESTS pattern. See
> `s02-l3-004c-fk-tautology-closure.md`.
>
> **Amended by S02-L3-004D (2026-08-25):** SC-TERMINAL-GUARD added
> (DB-level rejected-terminal invariant; machine form of
> `L2-QUARANTINE-GUARD`). SC-WATERMARK-RESTART upsert generalized to
> NOT-NULL-without-default columns. See `s02-l3-004d-terminal-guard.md`.

**Status: PRE-REGISTERED 2026-08-25, before promoted-master execution.**
Gate v2: `plans/scripts/sprint02-gate.ps1`. Fixture builder:
`plans/scripts/build-gate-fixtures.ps1`; materialized fixtures under
`plans/scripts/fixtures/{go,nogo}/`. v1 static rules (S02-L3-001) unchanged;
v2 adds XG-* static and SC-* live layers. No existing threshold weakened.

Basis: frozen AO-14/AO-15 (`ratification-manifest.json` pins, AO-15 sha
`69ED2EBE…CA95` verified), sprint-execution-map L69-75, validation report
2026-08-24. Controller-upheld frozen `status` + `idx_contrib_*` contract.

## Execution

```powershell
powershell -File plans/scripts/sprint02-gate.ps1 -SourceRoot <root> `
    [-DbDir <dir> | -SenDbPath <p> -CqDbPath <p>] `
    [-RunScenarios] [-RunProducerTests] [-OutJson result.json]
```

DB resolution order: explicit `-SenDbPath`/`-CqDbPath` → `-DbDir` →
`go/internal/localdb` recursive → `go/` → root. Exactly two identities:
`sen-product.db`, `community-queue.db` (map L71 names).

## Scenario matrix (frozen)

| # | Scenario | Rules | Mechanism | Expected on conformant master |
|---|---|---|---|---|
| S1 | Static durability + exact schema/index | SP-*, CQ-* (v1, unchanged) | Read-only pragma/schema introspection | All PASS |
| S2 | Exactly two DB identities | XG-DB-INVENTORY | Basename inventory under `go/internal/localdb`; distinct-file check | PASS; any extra `.db` or missing identity FAILs |
| S3 | No local PostgreSQL assumption | XG-NO-PG | DSN-shaped regex over localdb non-test `.go` | PASS; any DSN hit FAILs |
| S4 | Sanitizer forbidden-field evidence | XG-SANITIZER-SOURCE (static) + CQ-PRIVACY-SCAN + SC-PRODUCER-TESTS | Allowlist + ≥3 secret-pattern tokens in source; denylist column scan; producer adversarial suites | PASS on all three |
| S5 | Product writable while queue unavailable | XG-PRODUCT-STANDALONE | SP section evaluated with independent connection, no CQ dependency; proven live by standalone fixture run (CQ absent → SP all PASS, rule PASS, verdict NO-GO only from CQ-FILE) | PASS |
| S6 | export_candidate → queue crash-window replay/idempotency | XG-REPLAY-ANCHORS + SC-CRASH-REPLAY | Anchors: `content_hash` + `payload_hash UNIQUE`. Live on backup-API copies: commit candidate → crash → handoff insert → crash → reopen → replay insert (new row id, same hash) must be swallowed; exactly 1 row; candidate marked `exported` only after queue row confirmed | PASS; duplicate-on-replay FAILs (proven on NO-GO fixture: rows=2) |
| S7 | Publication receipt immutability | SC-RECEIPT-UNIQUE + CQ-UNIQUE-RECEIPT-HASH | Live: duplicate `receipt_hash` insert must raise IntegrityError; 1 row kept | PASS; NO-GO fixture proved duplicate accepted → FAIL |
| S8 | Removal/tombstone/watermark restart | SC-WATERMARK-RESTART + CQ-TABLES (`removal_reports`, `sync_watermarks`) + producer suites | Live: watermark upsert (TEXT pk + INTEGER seq introspected), close, reopen, value persisted. Removal/tombstone structural: table presence; behavioral proof via producer tests | PASS |
| S9 | Producer focused suites (live, no mocks) | SC-PRODUCER-TESTS | `go test -count=1 -run 'Adversarial\|Sanitiz\|Crash\|Replay\|Quarantine\|Receipt\|Watermark\|Backup\|Restore\|Corrupt\|Migration' ./internal/localdb/...` in `SourceRoot/go` | rc=0 PASS |

Integrity: `PRAGMA integrity_check` execution remains producer-side
(Lane 1 `core.IntegrityCheck`, reviewed PASS in S02-L3-002); gate verifies
its behavioral coverage via S9 (`Corrupt` family in pattern).

## Fixture evidence (self-test, 2026-08-25)

Fixtures are lane-3-owned real SQLite files + labeled `.go` evidence files
(`FIXTURE EVIDENCE ONLY — not producer code`). No fixture claimed as live;
live proof runs only against real target trees/copies.

| Run | Result | Exit |
|---|---|---|
| GO fixture, `-RunScenarios` | `GATE: GO` (31 rules, 1 expected WARN SP-TS-RFC3339-CHECK); all SC-* PASS on live copies | 0 |
| NO-GO fixture, `-RunScenarios` | `GATE: NO-GO [SP-WAL,SP-AUDIT-OUTBOX,SP-EXPORT-STATUS-CHECK,CQ-WAL,CQ-TABLES,CQ-STATUS-CHECK-SANITIZED,CQ-STATUS-CHECK-DELIVERY,CQ-UNIQUE-PAYLOAD-HASH,CQ-UNIQUE-RECEIPT-HASH,XG-DB-INVENTORY,XG-NO-PG,XG-SANITIZER-SOURCE,XG-PRODUCT-STANDALONE,SC-CRASH-REPLAY,SC-RECEIPT-UNIQUE]` | 1 |
| Standalone (community absent) | SP all PASS, XG-PRODUCT-STANDALONE PASS, `GATE: NO-GO [CQ-FILE,XG-DB-INVENTORY]` | 1 |
| Bad `-SourceRoot` | `GATE-ERROR` stderr | 2 |
| Lane-2 worktree, `-RunProducerTests` | SC-PRODUCER-TESTS PASS (rc=0, their suites live) while static NO-GO on unfixed schema — layers correctly independent | 1 |

## FALLBACK audit — error codes and exit semantics

| Condition | Exit | Determinism |
|---|---|---|
| `GATE: GO` (zero FAIL) | 0 | Rule set fixed; fixed scenario IDs/hashes/timestamps |
| `GATE: NO-GO` (≥1 FAIL) | 1 | WARN never affects verdict |
| Infra error (no python, bad SourceRoot, engine failure/non-JSON) | 2 | `GATE-ERROR:` on stderr via `Gate-Fatal` |

Fixed during audit: `Write-Error` under `ErrorActionPreference=Stop` threw
before `exit 2` (surfaced as 1) — replaced with stderr+`exit 2`;
SC-PRODUCER-TESTS decoupled from `-RunScenarios` nesting bug. All four exit
paths re-verified above.

Scenario mutations touch only temp backup-API copies (`%TEMP%\s02gate-sc-*`,
deleted after run); target DBs opened read-only. Deterministic: fixed IDs
(`gate-sc-*`), fixed hashes, fixed RFC3339 timestamps; reruns idempotent.

## Frozen-rule changes vs v1

None weakened. One precision tightening: CQ-STATUS-CHECK regex now requires
the CHECK to involve the `status` column (v1 accepted any CHECK in the
table) — strengthening only.

## Unresolved questions

- Removal/tombstone column-level shape is unpinned (AO-15 lacks
  `removal_reports` DDL; validation report names tables only). Gate asserts
  presence + watermark upsert-ability; richer assertions need a controller
  contract pin.

JOB_DONE: S02-L3-004A. NEXT: execute gate against promoted master after
S02-L1-003 and S02-L2-006 reviews.
