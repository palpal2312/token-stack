---
phase: 3
title: "Protect Core Contracts"
status: pending
priority: P1
effort: "8-10h"
dependencies: [2]
---

# Phase 3: Protect Core Contracts

## Overview

Cover deterministic behavior, malformed inputs, safety boundaries, and output
schemas for all seven locally implemented JavaScript core modules.

## Requirements

- Functional: keep compatibility for valid inputs and test explicit failures
  for invalid objects, malformed JSON, unsupported data, and timeout/error
  paths.
- Security: cache must never persist or return secret-like content; folded
  payloads must preserve tool IDs and message ordering; shell/query arguments
  must not become command injection.
- Performance: benchmark assertions use generous, reproducible upper bounds
  only where they detect regressions, never marketing claims.

## Test Scenario Matrix

| Module | Required cases |
|---|---|
| `semantic-cache` | exact/paraphrase hit, miss, threshold edges, malformed store, eviction, persistence/reload, secret prompt/response rejection |
| `model-router` | null/empty, simple/complex boundaries, explicit override, custom models, deterministic rationale |
| `skill-router` | internal/harness/auto scope, top-K limits, missing skill roots, stable ranking/tie behavior, generated context escaping |
| `data-lens` | CSV/TSV/PSV, BOM/null/quoted cells, empty/oversized/malformed input, local engine selection, escaped queries, timeout/fallback |
| `turn-folder` | zero/short/long messages, malformed payload, epochs/live window, id/order/schema preservation, idempotence |
| `cot-governor` | classifier boundaries, override validity/clamps, missing thinking object, no mutation of caller input unless documented |
| `guardrail` | distinct versus repeated calls, bounded history, token thresholds, 429-only failover, provider exception/no-secondary behavior |

## Related Code Files

- Modify: `core/*.cjs`
- Replace/migrate: `tests/semantic-cache.test.cjs`, `tests/model-router.test.cjs`,
  `tests/skill-router.test.cjs`, `tests/data-lens.test.cjs`,
  `tests/turn-folder.test.cjs`, `tests/cot-governor.test.cjs`,
  `tests/guardrail.test.cjs`, `tests/stress-edge-cases.test.cjs`
- Create: `tests/core/*.test.cjs`, `tests/fixtures/data/`

## Implementation Steps

1. Write contract tests for current valid behavior before any refactor.
2. Add table-driven invalid, boundary, and persistence cases from the matrix.
3. Add property-style generated cases for folding, CSV delimiters, and guardrail
   history while bounding size and seed so failures reproduce.
4. Add source-level or behavior-level secret regression tests that use
   synthetic markers only.
5. Run unit tests with Node coverage and set module-level thresholds after the
   first honest baseline; exclude only generated fixture code with a written reason.

## Todo

- [x] Each public core export has at least one error/boundary test and one happy-path test.
- [x] Each previously discovered regression has a named deterministic test.

## Success Criteria

- [x] Core coverage report identifies lines and branches by module.
- [x] No test accesses the real home directory, profile, or provider.

## Risk Assessment

Heuristic modules can overfit a small fixture corpus. Signal: a harmless
wording, delimiter, or ordering variation changes output unexpectedly.
Response: add minimized regression fixtures and state contract invariants
instead of asserting implementation internals.
