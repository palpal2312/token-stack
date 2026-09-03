---
phase: 2
title: "Core Property and Deterministic Fuzz"
status: complete
priority: P1
effort: "2-3d"
dependencies: [1]
---

# Phase 2: Core Property and Deterministic Fuzz

## Overview

Protect all seven CJS modules with table-driven boundaries, cross-layer contracts, seeded property testing, and minimized regression corpora.

## Requirements

- `node:test` + `fast-check`; every failure prints seed/path.
- Assert public invariants, disable host probing, and bound generated input/runtime.

## File Inventory

| Action | File | Purpose / test impact |
|---|---|---|
| Create | `tests/token-stack/core-properties.test.cjs` | Per-module and cross-module properties |
| Create | `tests/token-stack/core-fuzz-regressions.test.cjs` | Replay minimized failures |
| Create | `tests/token-stack/arbitraries.cjs` | Bounded generators |
| Create | `tests/token-stack/fixtures/fuzz/core-regression-corpus.json` | Stable non-secret corpus |
| Modify | `tests/token-stack/core.test.cjs` | Examples and exact boundaries |
| Modify | `package.json`, lockfile | Add compatible `fast-check` and commands |
| Conditional | seven `core/*.cjs` modules | Only defects/testability seams exposed by tests |

## Test Scenario Matrix

| Module | Examples / boundaries | Property oracle |
|---|---|---|
| Semantic cache | corrupt entries, 0/1/499/500/501, Unicode, secrets, write errors | cosine finite/symmetric/range; cap; no secret disk; round trip |
| Model router | slash/HTML override, files 3/4, length 2500/2501 | valid deterministic result; override precedence |
| Skill router | empty strict scope, duplicates, malformed frontmatter, topK/M | strict scope; sorted finite scores; bounds/dedupe/stable ties |
| Data Lens | quoted delimiters/newlines, ragged/header-only, BOM/NUL, 2MiB UTF-8, hostile path | extrema invariant; bounded summary; internal mode spawns nothing |
| Turn folder | epoch/live/char/line ±1, error variants, mixed blocks | count/order/schema; live/error unchanged; no expansion; idempotent/immutable |
| CoT governor | null blocks, 0/huge override, missing messages, file count | finite bounded budget; max-token invariant; disabled unchanged |
| Guardrail | reordered keys, cycle/BigInt, NaN/negative usage, empty tiers | bounded ring; canonical calls match; monotonic valid usage; transient-only failover |

## Function / Interface Checklist

- [ ] Every export has happy, invalid, exact-boundary, and reset coverage.
- [ ] Constructor injections cover paths, roots, tool detection, thresholds, windows, models.
- [ ] Return schemas cover `find`, `stats`, `route`, Data Lens, folding, governor, usage.
- [ ] Cross-layer corpus aligns router/governor, preserves final intent, secrets, data contracts, and replay policy.

## Dependency Map

```text
phase 1 -> examples + corpus -> properties -> coverage baseline -> phases 3 and 7
```

## Implementation Steps

1. Consolidate only safe legacy cases; do not execute legacy files unchanged.
2. Add exact boundaries and known-defect regressions.
3. Implement bounded generators/fixed seeds; persist reviewed minimized inputs.
4. Add cross-layer invariants and no-spawn/no-host-probe assertions.
5. Measure per-module coverage, then ratchet without excluding meaningful branches.

## Success Criteria

- [ ] PR: ≥500 cases/property; ≥1,000 for parsers/payload transformers/guardrail.
- [ ] Scheduled: ≥10,000 cases/module; seed replay is identical.
- [ ] Overall ≥85% lines / 75% branches. Each critical file—`semantic-cache.cjs`, `turn-folder.cjs`, `cot-governor.cjs`, `guardrail.cjs`—is ≥90% lines / 80% branches.
- [ ] Critical invariant IDs `CACHE-SECRET`, `FOLD-PRESERVE`, `COT-BOUND`, and `GUARD-FAIL-CLOSED` each have example, boundary, property, and regression-corpus ownership.
- [ ] Every corpus entry records invariant and seed/path.

## Risk Assessment And Rollback

Properties may freeze accidental behavior. Require contract rationale and verify counterexamples against docs. Quarantine only an unstable generator, never the invariant or deterministic regression.

## Todo

- [x] Add example/boundary matrix.
- [x] Add seeded generators and corpus.
- [x] Add cross-layer contracts.
- [x] Establish per-module coverage gates.
