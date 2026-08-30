# S10 Phase 4 controlled delivery and recovery receipt

## Scope and truthfulness

This receipt covers a deterministic, **simulated-redacted** canary and failure
drill model. It is not evidence of a live canary, daemon restart, restore, or
production backend recovery. The module has no network, daemon, queue, writer,
dispatch, release, or cutover authority; its publication result is always
`none`. Legacy writer remains disabled and Phase 21 remains blocked.

## Controls exercised

- explicit approval is required before a bounded canary;
- the fixture compares simulated baseline/candidate observations against a
  maximum error-rate and latency-ratio threshold;
- an approval rejection is a valid no-op with no canary;
- a threshold breach rolls back to the pinned baseline;
- a passing canary remains advisory only and cannot promote;
- supersession creates a new pending candidate and does not inherit approval;
- simulated daemon/restore inputs return replay-only, duplicate outbox is
  suppressed, stale lease and invalid snapshot fail closed, and unavailable
  backend is honestly not measurable;
- bounded simulated SLO/RPO/RTO values are carried as evidence, not measured
  live operational performance.

## Validation

```text
npx --no-install tsx --test qa/tests/s10-phase4-canary-recovery.test.ts
4 tests, 4 passed, 0 failed
```

## Producer-time pins (preserved)

```text
Producer SHA-256 `87e37aba196dabe5fab02d81ed9558bee44c962a5db8780fbca3e98d6b519607` — `src/lib/llmops/s10-phase4-canary-recovery.ts`
Producer SHA-256 `6cd679de4e29141ade783d1f7573bfeeb880be758e88daa810638c757e0524e6` — `qa/fixtures/sprint10/s10-phase4-simulated-canary-v1.json`
Producer SHA-256 `34db419658ce95b92a241f103e7105925dc44a55c1f278a9b6e0eeb8b1fa6c94` — `qa/tests/s10-phase4-canary-recovery.test.ts`
```

Status: DONE
Summary: Controlled simulated canary, rejection, rollback, supersession, and six recovery classifications are covered by focused tests.
Concerns/Blockers: Live recovery and monitored production measurements require controller-owned operational authority and remain outside this simulation receipt.

## Controller current-byte re-pin

The producer-time pins are retained above as historical evidence. The current
integrated Windows checkout hashes physical CRLF bytes, which differ from the
producer checkout. These controller pins bind the same scoped artifacts as
currently checked out; they do not expand canary, promotion, legacy-writer, or
Phase 21 authority.

f0a8d5e104c189a2193259a583be1e33ecf21f7e6f5d6e499a6a527b85f75ed9 src/lib/llmops/s10-phase4-canary-recovery.ts
5134035a133a59d7f34f81e5335b1029ef4e19ae5174cfa73ec6bcca4f3490c3 qa/fixtures/sprint10/s10-phase4-simulated-canary-v1.json
f8e55048bdfc3d959fe225f059544a23cce0b056e7a266625d67388b849c71cf qa/tests/s10-phase4-canary-recovery.test.ts
JOB_DONE: S10 Phase 4 simulated controlled-delivery/recovery evidence complete; candidate requires integration-owner promotion and independent arbiter review.
