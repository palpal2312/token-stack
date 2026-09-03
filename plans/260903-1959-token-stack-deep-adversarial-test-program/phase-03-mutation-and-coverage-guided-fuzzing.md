---
phase: 3
title: "Mutation and Coverage-Guided Fuzzing"
status: complete
priority: P1
effort: "1-2d"
dependencies: [2]
---

# Phase 3: Mutation and Coverage-Guided Fuzzing

## Overview

Measure whether tests detect behavioral defects, not only execute lines. Run mutation on scheduled module rotations; introduce coverage-guided fuzzing only after deterministic properties are stable.

## Requirements

- Mutate only seven core CJS modules; exclude generated/default-export noise with written reasons.
- Every surviving mutant is classified; jobs have hard deadlines and reproducible artifacts.
- No filesystem/network/process fuzz target in the initial coverage-guided tier.

## File Inventory

| Action | File | Purpose / test impact |
|---|---|---|
| Create | `stryker.token-stack.conf.json` | Core-only mutation config and TAP runner |
| Create | `tests/token-stack/mutation-contract.md` | Scores, exclusions, survivor disposition |
| Create | `scripts/test-token-stack-mutation.ps1` | Scheduled bounded mutation entrypoint |
| Create | `scripts/test-token-stack-fuzz.ps1` | Optional bounded Jazzer entrypoint |
| Modify | `package.json`, lockfile | Stryker/TAP and optional fuzz tooling |
| Modify | `.gitignore` | Ignore caches; retain reviewed JSON reports/corpora |
| Target | `core/*.cjs` | Mutated production surface only |

## Test Scenario Matrix

| Mutant/fuzz class | Examples | Required result |
|---|---|---|
| Boundary | 79/80, 499/500, topK 0/1, epoch threshold ±1 | mutant killed by exact-boundary test |
| Conditional/return | invert scope, skip secret check, false PASS, removed reset | mutant killed |
| Error handling | remove throw/catch, swallow timeout, change failover class | mutant killed or contract explicitly revised |
| Regex/parser | override capture, secret pattern, delimiter/date parsing | minimized reproducible counterexample |
| Liveness | infinite loop/timeout removal | hard job deadline; no leaked resource |

## Function / Interface Checklist

- [ ] Stryker consumes Node TAP output and emits JSON + human summary.
- [ ] Report groups score and survivors per module and critical invariant ID: `CACHE-SECRET`, `FOLD-PRESERVE`, `COT-BOUND`, `GUARD-FAIL-CLOSED`.
- [ ] Jazzer targets only pure parsing/transformation entrypoints with bounded buffers.
- [ ] Failure artifacts retain seed/corpus hash, never credentials or user paths.

## Dependency Map

```text
phase 2 properties/coverage -> one-module Stryker calibration -> seven-module rotation -> optional Jazzer -> phase 8 scheduled CI
```

## Implementation Steps

1. Calibrate Stryker on one high-value module; verify a deliberate mutant fails.
2. Expand to seven modules and triage every survivor as missing test, equivalent mutant, or unclear contract.
3. Set thresholds from empirical baseline, then ratchet.
4. Add time-bounded Jazzer targets for Data Lens, Turn Folder, cache JSON, and skill frontmatter only after deterministic replay is green.

## Success Criteria

- [ ] Overall mutation ≥75%; each named critical file and invariant ID ≥80% after calibration.
- [ ] No surviving secret, live/error preservation, override, scope, cap, or failover-classification mutant.
- [ ] 100% survivors own file/line/classification/rationale.
- [ ] Mutation/fuzz runs never execute on every PR and always terminate within configured budget.

## Risk Assessment And Rollback

Equivalent mutants and runtime cost can create noise. Rotate modules nightly and record equivalence explicitly; never silently lower thresholds. If Jazzer destabilizes native installs, retain fast-check/corpus replay and pause only the optional job.

## Todo

- [x] Calibrate and prove mutation gate integrity.
- [x] Expand module rotation and survivor workflow.
- [x] Add optional pure-function fuzz targets.
- [x] Publish machine-readable receipts.
