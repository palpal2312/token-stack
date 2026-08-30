---
title: "Sprint 10 evaluation operations and close gate"
status: todo
---

# Sprint 10 evaluation operations and close gate

## Overview

Evaluate integrated Sprint 08-09 behavior, calibrate SEN estimation and coordination intelligence, prove reversible promotion/rollback and operational readiness, then prepare close evidence for the next controller handoff.

## Requirements

- [ ] Persist signal, candidate, evidence, evaluation-suite/run, canary, promotion, rollback, and supersession records.
- [ ] Evaluate duration/effort estimation, critical-path/parallelism planning, OLC/lane allocation, and builder/workflow selection against frozen local Run Learning Records.
- [ ] Combine live state, stronger owner-local history, and only then matched community priors; never send private project queries to obtain forecasts.
- [ ] Measure elapsed/sequential-work error, prediction-interval coverage, lane-utilization error, retry/rework miss rate, acceptance calibration, and allocation regret.
- [ ] Require baselines, security/replay gates, approval, canary monitoring, and no-op/rejection outcomes.
- [ ] Add redacted metrics, alerts, runbooks, restore/replay evidence, and bounded SLO/RPO/RTO baselines.
- [ ] Keep release cutover and legacy retirement out of scope until the separate Phase 12 gate.

## Architecture and ownership

S10 owns estimator/calibration and evaluation registries, offline replay, shadow forecast, canary/rollback evidence, operational runbooks, and the close packet. It must not broaden product scope, launch workers directly, or reactivate legacy authority.
## Related Code Files

- `src/app/api/sen/evaluations/`
- `src/lib/llmops/`
- `go/cmd/sen-daemon/`
- `docs/windows-runtime-contract.md`

## Implementation Steps

1. Re-run integrated contract, replay, security, and performance suites against frozen S08-09 artifacts.
2. Replay baseline and candidate estimator/allocation policies on frozen learning records, then run shadow forecasts without affecting execution.
3. Evaluate one bounded canary improvement and one valid rejection/no-op; record evidence and rollback drill results.
4. Verify recovery for daemon crash, database restore, duplicate outbox, stale lease, unavailable canonical chat backend, and invalid/expired knowledge snapshot.
5. Produce a signed evidence manifest and independent arbiter report.
6. Close only when all acceptance criteria are GO; otherwise retain a diagnosed blocked state with bounded fallback.

## Success Criteria

- [ ] No candidate reaches promotion without approval and canary evidence.
- [ ] Forecasts expose assumptions, interval/confidence, critical path, useful lanes, and estimate-versus-actual; sparse cohorts fail honestly as low-confidence/out-of-distribution.
- [ ] Adding AI capacity is recommended only when measured marginal benefit shortens the critical path or reduces a named capacity risk.
- [ ] Learned policies remain advisory and cannot lower approval, privacy, review, capability, or budget gates.
- [ ] Rollback is proven without reactivating legacy canonical writes.
- [ ] Close report links every required receipt and names remaining risks.
- [ ] Independent arbiter accepts evaluation, operations, and recovery evidence.

## Risk Assessment

A green feature test may hide operational failure. Mitigate with restore/replay drills, crash injection, deterministic evidence, and an independent final arbiter.
