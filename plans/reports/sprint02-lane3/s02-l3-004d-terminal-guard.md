# S02-L3-004D — SC-TERMINAL-GUARD pre-registration (residual F3 machine rule)

**Status: PRE-REGISTERED 2026-08-25.** Converts the S02-L3-005A NO-GO rule
`L2-QUARANTINE-GUARD` (residual F3 resurrection path) into a live machine
rule. No existing check weakened.

## Rule: SC-TERMINAL-GUARD (FAIL-level, `-RunScenarios`)

On a temp backup-API copy of `community-queue.db` (originals read-only):

1. Insert fixed contribution `gate-sc-term-1` (`pending`).
2. `pending → quarantined` **must succeed** — valid pre-terminal quarantine
   stays legal.
3. Drive to terminal: `→ rejected` (tombstone mapping).
4. `rejected → quarantined` and `rejected → pending` **must be rejected by a
   DB-level invariant** (trigger/constraint) — not merely by producer API
   code. Direct SQL is the API-equivalent adversary.
5. Final status must still be `rejected`.

Rationale for DB-level demand: lane-1 enforced the analogous invariant with
SQL triggers (`export_candidates_transition`, S02-L1-005); API-only guards
are bypassable, as F3 showed (`Quarantine()` raw UPDATE).

## Discrimination proof (2026-08-25)

| Target | SC-TERMINAL-GUARD | Verdict |
|---|---|---|
| GO fixture (trigger `sanitized_contributions_terminal_guard` added) | PASS | `GATE: GO`, exit 0 |
| NO-GO fixture (no trigger) | FAIL — `rejected → quarantined resurrection accepted; no DB-level terminal guard` | `GATE: NO-GO […19 codes…]`, exit 1 |
| Current producer DBs, materialized via lane-2 `TestMaterializeGateDatabases` into temp (pre-L2-015 tree would fail identically to NO-GO fixture — F3 evidence) | **PASS** — materialized DB already carries `trg_prevent_rejected_transition` (BEFORE UPDATE OF status WHEN OLD='rejected' AND NEW!='rejected' → ABORT), i.e. L2-015 remediation landed | `GATE: NO-GO [XG-DB-INVENTORY]` — sole FAIL is a staging artifact (DBs materialized to temp, not under `go/internal/localdb`; resolves on promoted master), exit 1 |

Materialized producer DBs also passed all static SP/CQ rules (real AO-14/
AO-15 schemas, incl. contract CHECKs, UNIQUEs, indexes) and
SC-CRASH-REPLAY / SC-RECEIPT-UNIQUE / SC-FK-ENFORCED /
SC-WATERMARK-RESTART. Producer DB hashes: sen-product `4c6cd37f…`,
community-queue `7c356175…` (temp evidence, regenerated per run).

Bad `-SourceRoot` re-verified: exit 2.

## Gate fix shipped alongside (not a weakening)

`SC-WATERMARK-RESTART` previously assumed a 2-column watermark upsert and
failed on the producer's legitimate `updated_at TEXT NOT NULL` (no default).
Now introspects NOT-NULL-without-default columns and fills them
deterministically by declared type. Assertion (value survives close/reopen)
unchanged.

## Fixture changes

GO tree `community-queue.db` gains
`sanitized_contributions_terminal_guard` trigger (models the conformant
post-015 end-state). NO-GO tree unchanged otherwise (no trigger → rule
falsifiable). Rebuilt; sidecars cleaned.

## Hashes

| File | SHA-256 |
|---|---|
| sprint02-gate.ps1 | `c7d249c70eb62fe76354c0f95b75521b94dc6d64f92186631d8ba454cbf71c34` |
| build-gate-fixtures.ps1 | `4920aca7b9c422cd0d71224d85bf3c5aca1ff583d443e8bc5c7bfe8d9d7b3aeb` |
| fixtures/go community-queue.db | `eeb290af893f207480228384988307a474bc9214dd4e1cee0719d4a936eb4237` |
| fixtures/go sen-product.db | `a06b454cf5acbc0ebba3699d2a8986c8d783f9d05f0d14cf4ead954000e83731` |
| fixtures/nogo community-queue.db | `a828a7e6643c61e89004566c9122a35bd652d66412bcd297396f81da42d8d3db` |
| fixtures/nogo sen-product.db | `323a5474fee3cb0f062639917bbae530c3005b7d231f3126fae6ab751b24cd36` |

## Unresolved questions

- None.

JOB_DONE: S02-L3-004D. NEXT: rereview S02-L2-015 remediation, then
promoted-master gate run.
