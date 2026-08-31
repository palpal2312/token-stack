# S02-L3-004C — FK tautology closure (controller-authorized)

**Status: APPLIED 2026-08-25.** Removes the set-then-read `foreign_keys`
self-dealing noted in S02-L3-004B. No threshold weakened; the replacement
chain is strictly stronger (static + live + producer-runtime).

## Problem

v1/v2 gate executed `PRAGMA foreign_keys=ON` on its own inspection
connection, then read it back and claimed `SP-FK`/`CQ-FK` proof. Per-connection
pragmas say nothing about the file or producer connections — tautology.

## Replacement evidence chain

1. **XG-FK-SOURCE** (FAIL-level, static): `foreign_keys(ON)` DSN form or
   `PRAGMA foreign_keys = ON` exec form present in localdb non-test `.go`
   connection sources. Connection-less schemas cannot claim FK enforcement.
2. **SC-FK-ENFORCED** (FAIL-level, live, `-RunScenarios`): on a temp
   backup-API copy of `community-queue.db`, insert an orphan
   `delivery_attempts` row under an FK-ON connection; declared FKs must
   reject it. Proves schema-declared FKs are enforceable, not decorative.
3. **SC-PRODUCER-TESTS** pattern widened with `Pragma|Introspection|
   Conformance` so producer suites asserting live `PRAGMA foreign_keys=1`
   (Lane 1 `TestAO14SchemaPragmasAndChecks`, Lane 2 `RuntimeIntrospection`)
   run inside the gate.

`SP-FK`/`CQ-FK` rule codes retired; the gate's inspection connection no
longer sets any pragma.

## Proof runs (2026-08-25)

| Run | Result | Exit |
|---|---|---|
| GO fixture, `-RunScenarios` | `GATE: GO`; XG-FK-SOURCE PASS (fixture DSN evidence), SC-FK-ENFORCED PASS (orphan rejected) | 0 |
| NO-GO fixture, `-RunScenarios` | `GATE: NO-GO […,XG-FK-SOURCE,…]` (17 codes; FK evidence absent); SC-FK-ENFORCED PASS (schema still declares FKs — rule falsifiability shown by XG-FK-SOURCE side) | 1 |
| Bad `-SourceRoot` | `GATE-ERROR` stderr | 2 |
| Lane-1 real tree, `-RunProducerTests` | XG-FK-SOURCE PASS on producer `core/database.go`; SC-PRODUCER-TESTS rc=0 over core+product incl. pragma/conformance families | n/a |

One authoring defect fixed during proofs: a line-join in
`sc_watermark_restart` (engine IndentationError → clean exit 2) — repaired
and re-proven.

## Hashes

| File | SHA-256 |
|---|---|
| sprint02-gate.ps1 | `7ba4928e02fef070a2403b0163fc204eb82b54b67c7bfdc4bbb656a6be3448b3` |

Fixtures unchanged this round (GO tree already carried FK-ON DSN evidence
from S02-L3-004B); fixture hashes in `s02-l3-004b-gate-corrections.md`
remain current.

## Unresolved questions

- None.

JOB_DONE: S02-L3-004C. NEXT: final producer snapshot review (S02-L1-004,
S02-L2-006/007) after producer JOB_DONE, then promoted-master gate run.
