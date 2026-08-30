# S10 Lane A offline evaluation receipt

## Scope and authority

This receipt records a deterministic, in-memory evaluation of a frozen,
redacted local fixture. It creates no worker-launch, dispatch, allocation,
persistence, endpoint, promotion, cutover, legacy-writer, or Phase 21
authority. The legacy writer remains disabled and Phase 21 remains blocked.

## Implemented boundary

`src/lib/llmops/s10-replay-evaluation.ts` is a dedicated pure evaluator. It
accepts only a `frozen-redacted-replay` snapshot with normalized timestamps and
pseudonymous metric fields. Inputs containing forbidden private-content keys,
empty cohorts, or invalid provenance fail closed as a `not-measurable` no-op.
It does not import a shared DTO/schema barrel or any LLMOps writer, queue,
network, endpoint, or release control.

The evaluator reports the seven opening-manifest metrics: elapsed error,
sequential error, coverage, utilization, retry/rework miss (including false
positives), acceptance calibration, and allocation regret. Sparse cohorts are
explicitly low-confidence and out-of-distribution. Critical-path and useful
lane output is advisory only: it can recommend review, never capacity or
execution action. Local frozen history is the only accepted evidence source;
no community or private-project lookup is attempted.

## Frozen inputs and current-byte pins

| Artifact | SHA-256 |
|---|---|
| S10 Phase 04 plan | `99E11F014E267FC6EA178D45CA516E290E9FD5CCD92C3BBC0CC96DF04D2FD7A0` |
| S10 Phase 05 plan | `256D51F41E12B20995F7C8176F56A2762FAD36D8BB0566F853DC58CC04A79544` |
| Redacted canary fixture | `15739FCCA6D2E68580A24FC1EEEC1ED911FEA6C9CA831248840D050D74ACCFBD` |
| Dedicated evaluator | `9A2E3356893BE5ACE63FB7BF69AF8B0BFC73F61F40C6909226F84B17C727A768` |
| Focused test | `726ABABABA9EBD76EBBB94E223E93650AF236E00DA66A4291BCA868767735AE6` |

```text
15739FCCA6D2E68580A24FC1EEEC1ED911FEA6C9CA831248840D050D74ACCFBD qa/fixtures/sprint10/redacted-canary-v1.json
9A2E3356893BE5ACE63FB7BF69AF8B0BFC73F61F40C6909226F84B17C727A768 src/lib/llmops/s10-replay-evaluation.ts
726ABABABA9EBD76EBBB94E223E93650AF236E00DA66A4291BCA868767735AE6 qa/tests/s10-lane-a-evaluation.test.ts
```

## Validation

`npx tsx --test qa/tests/s10-lane-a-evaluation.test.ts` passed: 3 tests, 0
failures. It proves deterministic seven-metric output, no-op rejection of
private/unavailable input, low-confidence/OOD signaling, and advisory
critical-path/useful-lane output.

Repository-wide `npx tsc --noEmit` remains blocked by pre-existing unrelated
errors in `qa/tests/s10-offline-recovery-operations.test.ts` (`Record` shadow),
and `src/app/api/thumbnails/file/route.ts` (missing `sharp` and unsafe optional
buffer use). The focused Lane A test is clean.

## Limits and next gate

The cohort has two records, so this is not a production calibration or a GO
verdict. Any evaluation/promotion/canary/operations close decision remains with
the controller and independent arbiter under the separately authorized S10
lanes.

JOB_DONE: Lane A isolated frozen-redacted evaluation/replay capability completed; no GO/NO-GO or execution authority issued.
