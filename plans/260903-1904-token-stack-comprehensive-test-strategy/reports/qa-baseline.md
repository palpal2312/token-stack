---
title: "Token-Stack QA baseline"
date: 2026-09-03
status: completed
---

# Token-Stack QA baseline

## Result

- Offline suite: 19 passed, 0 failed, 0 skipped.
- TypeScript: `npx tsc --noEmit` passed.
- Existing Agentic OS suite: 58 passed, 0 failed.
- Static credential-literal scan: passed for Token-Stack source and test code.

## Coverage

| Metric | Baseline | Enforced floor | Status |
|---|---:|---:|---|
| Lines | 84.89% | 80% | PASS |
| Branches | 73.75% | 65% | PASS |
| Functions | 81.08% | Informational | PASS |

The floors are deliberately baseline-derived. They are not evidence that every
heuristic branch is equally important; cache secret rejection, setup path
isolation, verifier opt-in/failure behavior, and process ownership are enforced
by named tests regardless of aggregate coverage.

## Remaining Coverage Work

- Add negative provider/proxy verifier cases and setup permission-failure cases.
- Expand DataLens parsing/error-path fixtures before raising branch coverage.
- Keep live provider verification opt-in; it is not a CI gate.
