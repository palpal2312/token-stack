# S10 offline recovery and operations receipt

## Scope and authority

This is offline evidence from one redacted, frozen fixture. It creates no
production SLO, approval, promotion, worker launch, dispatch, endpoint,
network, persistence, legacy-writer, cutover, or Phase 21 authority. The
legacy writer remains **disabled** and Phase 21 remains **blocked**.

## Frozen inputs and bounded operating baselines

| Input or baseline | Value | Meaning |
|---|---:|---|
| Fixture | `redacted-recovery-v1.json` | Numeric/pseudonymous local replay only. |
| Cohort size | `2` | Illustrative frozen replay; not a production sample. |
| Offline replay SLO | `<= 1 s` | Local focused-test completion target for this evidence only. |
| Offline derived-artifact RPO | `0` | Recompute from hash-pinned fixture rather than recover mutable output. |
| Offline derived-artifact RTO | `<= 1 s` | Re-run the local deterministic evaluator after an interrupted derivation. |

These are bounded test baselines, not availability, durability, or performance
claims for a service. No database, queue, process, or network capability is
used or measured.

## Recovery model and results

The fixture includes a `derived-partial` checkpoint containing only
`elapsed_error`. A recovery recomputes the complete seven-metric descriptor
from the same fixture bytes. Partial and complete outputs have different
status and publication keys, so an incomplete derivation cannot be represented
as a completed publication.

| Check | Result | Evidence |
|---|---|---|
| Restart from frozen input | PASS | Re-parsing the same JSON produces the same complete publication key. |
| Partial versus complete | PASS | `partial` contains one metric; `complete` contains all seven. |
| Duplicate publication | PASS | First complete key is accepted; same-key restart is `duplicate-suppressed`. |
| Unavailable input | PASS | Empty input is `not-measurable`, no publication key. |
| Forbidden field | PASS | An in-memory malformed input with a forbidden field fails closed, no publication key. |
| Redaction/security | PASS | Fixture has only pseudonymous IDs and numeric fields; no URL or sensitive-content field is accepted. |
| No command/network side effects | PASS | Focused test statically rejects command, file-write, and network APIs; evaluator imports only local read/hash/test modules. |

The local registry in the test is an in-memory model for evidence only. It is
not a persistence mechanism or a production duplicate-prevention claim.

## Validation and current-byte pins

Run in the evidence worktree:

```powershell
npx tsx --test qa/tests/s10-offline-recovery-operations.test.ts
Get-FileHash -Algorithm SHA256 qa/fixtures/sprint10/redacted-recovery-v1.json
Get-FileHash -Algorithm SHA256 qa/tests/s10-offline-recovery-operations.test.ts
```

The resulting SHA-256 values are recorded below after the focused test passes.
Consumers must recompute them against the current bytes before relying on this
receipt.

| Artifact | SHA-256 |
|---|---|
| `qa/fixtures/sprint10/redacted-recovery-v1.json` | `1D1C919AD91857AF92AF5C5617E524C307D58B8687EA1BFD945DD8A507DE066E` |
| `qa/tests/s10-offline-recovery-operations.test.ts` | `7CC1EBBB099FCD768BEC78D9E8E8D5F05C022721E2C9862794104DC11E712187` |

Machine-verifiable current-byte pins:

```text
1D1C919AD91857AF92AF5C5617E524C307D58B8687EA1BFD945DD8A507DE066E qa/fixtures/sprint10/redacted-recovery-v1.json
7CC1EBBB099FCD768BEC78D9E8E8D5F05C022721E2C9862794104DC11E712187 qa/tests/s10-offline-recovery-operations.test.ts
```

## Limits and next gate

This evidence supports only an offline recovery/replay review. It does not
prove a daemon crash recovery, database restore, outbox behavior, stale lease
handling, live backend availability, production SLOs, approval, promotion, or
cutover. Those remain separately required before an independent S10 close
verdict.

JOB_DONE: S10 redacted offline recovery and operations evidence completed; no GO/NO-GO or execution authority issued.
