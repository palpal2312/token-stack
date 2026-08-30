# S10 Phase 3 replay and calibration receipt

## Scope

This phase adds a pure, deterministic calibration wrapper over the existing
S10 frozen-redacted evaluator. It replays baseline and candidate policies over
the same local cohort, records explicit assumptions and deterministic
prediction intervals, and exposes critical-path/useful-lane/workflow output as
advisory only. It performs no network access, private query, dispatch,
persistence, writer, endpoint, cutover, legacy-writer, or Phase 21 action.

## Evidence

- Seven metrics remain computed by the pinned evaluator with per-metric
  denominator/exclusion rules; missing values are never imputed.
- Baseline and candidate are independently evaluated from identical frozen
  redacted input bytes; identical metrics prove the comparison is controlled.
- Intervals are deterministic and explicitly low-confidence for sparse cohorts.
- Sparse, private, and unavailable inputs fail closed to `not-measurable` and
  `no-op` with no publication key.
- Critical path, useful lanes, and added capacity remain advisory review
  signals; they cannot authorize execution.
- Privacy precedence is local frozen history only; community priors and private
  project lookups are not available to this module.

## Current-byte pins

```text
8AAA8F3E13C1817106E99726ED6F0730443806DE8375990C1AB3305862E59242 src/lib/llmops/s10-replay-calibration.ts
DEA6B54C78EE748FE03699286542E6A5E3907A8D102F7FB7DEC44AC95464BAD2 qa/tests/s10-phase3-replay-calibration.test.ts
```

Validation: `npx tsx --test qa/tests/s10-phase3-replay-calibration.test.ts` —
3/3 passed.

JOB_DONE: S10 Phase 3 replay/calibration evidence completed; no execution or
promotion authority issued.
