# S10 Lane B controlled-delivery receipt

## Scope and authority

This is an advisory-only, in-memory control record. It creates no worker
launch, network dispatch, persistence, endpoint, promotion, release, cutover,
legacy-writer, or Phase 21 authority. The legacy writer remains disabled and
Phase 21 remains blocked.

## Implemented boundary

`src/lib/llmops/s10-controlled-delivery.ts` is a dedicated state machine with
no imports. A candidate starts `awaiting-approval`; its bounded observational
canary cannot start until an explicit `approve` decision. A `reject` decision
is a valid inert no-op and cannot start a canary.

The canary accepts only 1–100 monitor observations. An alert fails closed to
`rolled-back`, retaining the exact SHA-256 baseline pin. A completed bound can
produce only `canary-passed` advisory evidence. Rollback and supersession have
no external side effect; a superseding candidate is always a new, pending
approval and cannot inherit either approval or canary result.

All results carry `advisory: true` and `effect: "none"`. There is no legacy
writer, shared DTO/schema barrel, release/cutover control, or dispatch path.

## Current-byte pins

| Artifact | SHA-256 |
|---|---|
| S10 opening manifest | `C437224B0C7443AC485A4C9B4A59B3AFA5110771A6AF3710427CC39DC8F97CD7` |
| Controlled-delivery state machine | `A6366F70405F081A0B7EF2A3BDD947810CA1B95EBB05CE83D1C5208AEB84F722` |
| Focused test | `CE95F43B4265E4174C9E10651F8B48CD85AA3B2235DA25A10849807361B0EA3D` |

```text
C437224B0C7443AC485A4C9B4A59B3AFA5110771A6AF3710427CC39DC8F97CD7 plans/reports/sprint10/s10-evaluation-opening-manifest.md
A6366F70405F081A0B7EF2A3BDD947810CA1B95EBB05CE83D1C5208AEB84F722 src/lib/llmops/s10-controlled-delivery.ts
CE95F43B4265E4174C9E10651F8B48CD85AA3B2235DA25A10849807361B0EA3D qa/tests/s10-controlled-delivery.test.ts
```

## Validation

`npx --no-install tsx --test qa/tests/s10-controlled-delivery.test.ts` passed:
4 tests, 0 failures. The tests prove approval-before-canary enforcement,
valid rejection/no-op behavior, bounded monitored alert rollback, and
approval-resetting supersession.

Repository-wide `npx --no-install tsc --noEmit` remains blocked by pre-existing
unrelated errors in `qa/tests/s10-offline-recovery-operations.test.ts` (a
shadowed `Record`) and `src/app/api/thumbnails/file/route.ts` (missing `sharp`
types and an optional buffer). The focused Lane B test is clean.

## Limit and next gate

This receipt is not a promotion, release, or GO/NO-GO verdict. Any use of the
advisory record remains subject to the independent S10 arbiter and operational
evidence gates.

JOB_DONE: Lane B isolated approval-gated controlled-delivery control completed; no execution authority issued.
