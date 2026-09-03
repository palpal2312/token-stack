---
phase: 8
title: "CI Evidence and Live Certification"
status: complete
priority: P1
effort: "1-2d"
dependencies: [3, 5, 6, 7]
---

# Phase 8: CI Evidence and Live Certification

## Overview

Publish distinct, fail-closed PR, scheduled, and protected-manual gates with reproducible receipts. Live provider certification stays explicit, bounded, redacted, and outside normal CI.

## Requirements

- PR runs offline unit/integration/property/security/coverage only.
- Mutation/fuzz/flake/soak/performance use scheduled/manual budgets and concurrency cancellation.
- Live requires protected approval, named profile, approved HTTPS hostname, short-lived credential, and a hard cap of two upstream calls, ten requested output tokens, eight synthetic input tokens, and USD 0.02 estimated cost.

## File Inventory

| Action | File | Purpose / test impact |
|---|---|---|
| Create | `scripts/test-token-stack-flake.ps1` | N-run repeatability without retry masking |
| Create | `scripts/certify-token-stack-live.ps1` | Protected preflight, one bounded run, cleanup/redaction |
| Create | `tests/token-stack/live-certification-checklist.md` | Operator and evidence contract |
| Create | `plans/260903-1959-token-stack-deep-adversarial-test-program/reports/test-evidence-template.md` | Machine/human receipt fields |
| Modify | `.github/workflows/ci.yml` | Required offline/coverage and compatibility jobs |
| Create/Modify | `.github/workflows/token-stack-deep-tests.yml` | Scheduled mutation/fuzz/flake/soak/performance |
| Create/Modify | `.github/workflows/token-stack-live-certification.yml` | Manual protected live workflow |
| Modify | `package.json`, `scripts/test-token-stack.ps1`, `scripts/test-token-stack-live.ps1` | Stable commands and exit semantics |
| Modify | `tests/test-manifest.md`, `docs/token-stack-testing.md`, README variants | Accurate suite counts, gates, support, live policy |

## Test Scenario Matrix

| Gate | Trigger | Blocking policy | Evidence |
|---|---|---|---|
| Offline examples/integration/property/security | every PR/push | required; zero skip | TAP/JUnit + isolation receipt |
| Coverage | every PR | ≥85/75 overall + critical ratchet | machine-readable per-module JSON |
| Compatibility | PR/manual by declared shell | required only for promised targets | install/runtime receipt |
| Flake N=20 | nightly/manual | required after stable baseline; no retry masking | first-failure + all-run summary |
| Mutation | nightly rotation | threshold after calibration | JSON score/survivors |
| Fuzz/soak/performance | scheduled/manual | correctness/leak blocking; timing calibrated | seed/corpus/perf/resource receipt |
| Live certification | manual protected environment | never default PR; required only for release promise | redacted certificate |

## Function / Interface Checklist

- [ ] Commands have stable nonzero failure and do not parse human coverage output where machine output exists.
- [ ] Artifacts record commit, command, OS, Node/shell, seed/corpus/fixture hash, thresholds, duration, cleanup.
- [ ] Live preflight requires explicit workflow input + environment approval + named profile + credential + allowlisted host.
- [ ] Live request: concurrency 1, at most two calls total (direct + proxy), `max_tokens: 5` each, fixed prompt ≤8 tokens, total requested output ≤10 tokens, no redirect, strict deadlines.
- [ ] Preflight resolves trustworthy model pricing and proves estimated total ≤USD 0.02; missing/unknown pricing or any counter overflow aborts before the next request.
- [ ] Certificate excludes headers, prompt/response content, secrets, URL userinfo/query, private local paths.

## Dependency Map

```text
phases 3 + 5 + 6 + 7 receipts -> PR/scheduled workflows -> N=20 flake proof -> protected live certificate -> final QA report
```

## Implementation Steps

1. Split fast required PR gates from deep scheduled jobs; make coverage machine-readable and blocking.
2. Add flake runner that retains the first failure and never turns retry success into PASS.
3. Upload redacted receipts with bounded retention and concurrency cancellation.
4. Implement atomic live counters checked before each direct/proxy request: call count ≤2, requested output ≤10, prompt ≤8 tokens, estimated cost ≤USD 0.02; abort before dispatch on any unknown or overflow.
5. Update contributor docs and stale README counts from observed canonical totals.
6. Execute whole-plan gate and publish a QA report listing PASS/FAIL/SKIP/BLOCKED by capability.

## Success Criteria

- [ ] Clean checkout PR gate passes with zero external access, skips, secret leaks, or resource leaks.
- [ ] Same failing seed/corpus/artifact reproduces locally; N=20 offline full runs have zero flakes.
- [ ] Threshold changes require versioned rationale/evidence; no silent baseline rewrite.
- [ ] Live defaults unavailable, performs at most authorized request budget, and leaves zero credential-bearing artifact/resource.
- [ ] Missing live profile/key/approval is a nonzero certification preflight failure, not a passing SKIP.

## Risk Assessment And Rollback

Deep jobs can consume excessive CI minutes and live calls can cost money. Set hard timeouts, module rotation, concurrency cancellation, and manual protected environments. If one scheduled job destabilizes, disable only that job; offline PR correctness/security gates remain mandatory.

## Todo

- [x] Add required PR gates and machine-readable coverage.
- [x] Add scheduled deep jobs and flake proof.
- [x] Add protected, bounded live certification.
- [x] Update docs and publish final evidence report.
