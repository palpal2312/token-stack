---
phase: 7
title: "Performance, Soak, and Resource Bounds"
status: complete
priority: P2
effort: "1-2d"
dependencies: [2, 4, 5]
---

# Phase 7: Performance, Soak, and Resource Bounds

## Overview

Detect asymptotic, latency, memory, handle, descriptor, process, and listener regressions using fixed workloads and statistical baselines rather than brittle one-shot timings.

## Requirements

- Separate fast PR smoke, controlled benchmark, and nightly soak.
- Fixed seed/fixture hash, warm-up, sample count, median/p95 and variance.
- Correctness/resource leaks block immediately; timing blocks only after stable calibration.

## File Inventory

| Action | File | Purpose / test impact |
|---|---|---|
| Create | `tests/token-stack/performance.test.cjs` | Structural bounds and PR smoke |
| Create | `tests/token-stack/soak.test.cjs` | Long-running state/resource cycles |
| Create | `scripts/benchmark-token-stack.cjs` | Controlled measurements and JSON receipt |
| Create | `scripts/test-token-stack-soak.ps1` | Bounded scheduled entrypoint |
| Create | `tests/token-stack/performance-baseline.json` | Versioned workload/variance/baseline |
| Create | `plans/260903-1959-token-stack-deep-adversarial-test-program/reports/performance-methodology.md` | Calibration and interpretation contract |
| Modify | `package.json` | Benchmark/soak commands |

## Test Scenario Matrix

| Workload | Scale | Metrics / failure injection |
|---|---:|---|
| Cache | 500 entries; 50k mixed ops | p50/p95, heap slope, corrupt reload, cap |
| Router/CoT/guardrail | 100k calls; 10k waterfalls | throughput, determinism, bounded ring, error sequences |
| Turn folder | 10k messages | latency, peak heap, non-expanding output |
| Data Lens | fixed 2MiB data/log | latency, memory, malformed rows, no external engine |
| Skill router | 250 and 1,000 synthetic skills | index/query p95, heap, stable ranking |
| CLI/verifier lifecycle | 20+ cycles | startup/deadline, handles/PIDs/listeners/temp debris |

## Function / Interface Checklist

- [ ] Benchmark schema: commit, platform, versions, seed, fixture hash, samples, median/p95, variance, cleanup.
- [ ] Each batch uses ≥20 warm-ups and ≥100 measurements; each baseline/comparison uses five independent batches.
- [ ] GC/heap interpretation is advisory unless runner control is documented.
- [ ] Process/listener/filesystem leak checks reuse phase 1 ownership receipts.

## Dependency Map

```text
phase 2 fixed corpus + phase 4 lifecycle + phase 5 chaos -> smoke benchmark -> variance calibration -> nightly soak -> phase 8 gates
```

## Implementation Steps

1. Define fixed workloads and structural invariants before recording time.
2. Capture five baseline batches on a non-parallel runner. Stability formula: `100 * MAD(batch medians) / median(batch medians) <= 10`.
3. Add PR smoke for bounds/complexity and nightly soak for state/resource growth.
4. After baseline and comparison both satisfy the stability formula, fail timing only when the median of five comparison batch medians is greater than `1.25 *` the versioned baseline median. Report p95 but do not use it as a blocking threshold initially.
5. Soak must satisfy both ≥60 minutes and workload floors: ≥50,000 operations per pure core module, ≥100 owned lifecycle cycles, and ≥100 complete verifier-chaos matrix iterations.

## Success Criteria

- [ ] Both five-batch baseline and comparison have `MAD/median ≤10%` before timing blocks.
- [ ] Stable comparison median is ≤125% of versioned baseline median.
- [ ] Nightly soak meets 60m and all workload floors: zero exception, orphan PID/listener/temp artifact; bounded state.
- [ ] Marketing latency claims remain outside unit gates unless controlled evidence supports them.

## Risk Assessment And Rollback

Hosted runners are noisy and antivirus delays cleanup. If timing is unstable, make timing informational while keeping deterministic output/state/cleanup gates blocking. Rebind/cleanup checks may use a bounded poll, never an unbounded retry.

## Todo

- [x] Define fixed workloads and receipt schema.
- [x] Calibrate variance and version baseline.
- [x] Add PR structural smoke.
- [x] Add nightly resource soak.
