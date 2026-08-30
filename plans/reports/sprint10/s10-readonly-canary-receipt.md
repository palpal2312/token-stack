# S10 bounded local read-only canary receipt

## Scope and authority

This receipt records a local, deterministic replay of one redacted fixture.
It creates no approval, promotion, worker-launch, dispatch, endpoint, network,
persistence, legacy-writer, or Phase 21 authority. The legacy writer remains
disabled and Phase 21 remains blocked.

## Frozen inputs

| Input | SHA-256 |
|---|---|
| S10 Phase 04 plan | `3FF624F7AF148DA427370DDD6D622C099F40F19C09A4EA4D18EF33B33EC28F64` |
| S10 Phase 05 plan | `2D164FBAEA828A398B5817F6FBAFBE3FC7F2BE73B840DCA9309B696CF8CC39AF` |
| Redacted fixture | Recorded below after focused validation. |
| Focused evaluator test | Recorded below after focused validation. |

The fixture contains only pseudonymous IDs, normalized durations, capacity,
retry identity sets, a frozen independent boolean outcome, and numeric
counterfactual results. It contains no prompt, conversation, repository/path
identity, secret, credential, personal data, raw log, network reference, or
live state.

## Measured canary scorecard

The single cohort has two complete eligible records. The pure evaluator reports:

| Metric | Result | Fixed policy |
|---|---|---|
| Elapsed error | signed `500 ms`; absolute `1500 ms` | predicted minus observed over frozen records |
| Sequential error | signed `0 ms`; absolute `1000 ms` | no missing dependency edge in fixture |
| Coverage | `2/2 = 1.00` | only complete frozen records eligible |
| Utilization | `11000/20000 = 0.55` | pinned available capacity; never imputed |
| Retry/rework miss | `1` missed; `0` false positive | pseudonymous attempt-ID set deduplication |
| Acceptance calibration | Brier score `0.04`, `n=2` | frozen independent boolean outcome |
| Allocation regret | mean `1000 ms` | minimum eligible counterfactual; ties equivalent |

These are measurements only. No threshold is approved, and this receipt is not
a GO verdict.

## Gate results

| Gate | Result | Evidence |
|---|---|---|
| Baseline | PASS | Hash-pinned S10 Phase 04/05 inputs listed above. |
| Security/redaction | PASS | Fixture schema is numeric/pseudonymous only; focused test rejects serialized side-effect markers. |
| Replay | PASS | Same frozen input yields identical SHA-256-derived publication key. |
| No-op | PASS | Empty/unavailable cohort returns only `not-measurable`, null publication key, and leaves fixture hash unchanged. |
| Recovery | PASS | Re-running the same input yields one unique publication key; no duplicate publication. |
| Shadow/read-only | PASS | Test uses only local JSON read and pure in-memory computation. |

## Validation

Run from this worktree:

```powershell
npx tsx --test qa/tests/s10-readonly-canary.test.ts
Get-FileHash -Algorithm SHA256 qa/fixtures/sprint10/redacted-canary-v1.json
Get-FileHash -Algorithm SHA256 qa/tests/s10-readonly-canary.test.ts
```

Expected focused-test result: 3 passed, 0 failed. The Git checkout used to
author the first receipt retained LF worktree bytes, while the clean Windows
worktree used by the standard verifier materializes these tracked files as
CRLF. Because the verifier intentionally hashes physical checkout bytes, the
portable pins below are the observed CRLF bytes from a fresh clean worktree;
every consumer must recompute them in its own clean checkout before using this
receipt.

| Artifact | SHA-256 |
|---|---|
| `qa/fixtures/sprint10/redacted-canary-v1.json` | `15739FCCA6D2E68580A24FC1EEEC1ED911FEA6C9CA831248840D050D74ACCFBD` |
| `qa/tests/s10-readonly-canary.test.ts` | `ED1695F6C223A11A3204523A62CCC6E22A1372CE97A5151680D8A46C4E3BFCEC` |

Machine-verifiable current-byte pins:

```text
15739FCCA6D2E68580A24FC1EEEC1ED911FEA6C9CA831248840D050D74ACCFBD qa/fixtures/sprint10/redacted-canary-v1.json
ED1695F6C223A11A3204523A62CCC6E22A1372CE97A5151680D8A46C4E3BFCEC qa/tests/s10-readonly-canary.test.ts
```

## Limits and next gate

This is a bounded frozen replay. It does not demonstrate production forecast
accuracy, authorize promotion/cutover, or replace required operational,
security, restore/replay, approval, canary-monitoring, and independent-arbiter
evidence. Any unavailable input must remain a no-op `not-measurable` result.

JOB_DONE: bounded local read-only canary evidence completed; no GO/NO-GO or execution authority issued.
