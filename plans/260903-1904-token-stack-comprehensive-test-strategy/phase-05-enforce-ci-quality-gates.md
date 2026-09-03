---
phase: 5
title: "Enforce CI Quality Gates"
status: pending
priority: P1
effort: "4-6h"
dependencies: [3, 4]
---

# Phase 5: Enforce CI Quality Gates

## Overview

Wire the new test commands into CI, define coverage and report expectations,
and provide a controlled release-quality verdict without conflating Token-Stack
tests with the co-located Agentic OS suite.

## Requirements

- Functional: CI runs the Token-Stack offline suite as its own required job;
  existing Agentic OS jobs remain unchanged and separately named.
- Non-functional: test output is concise, machine-readable, and retains failed
  test diagnostics without printing secrets.
- Quality: establish coverage targets only after a measured baseline; critical
  safety paths (cache secrets, setup paths, verifier auth/network boundary) are
  mandatory regardless of aggregate percentage.

## Related Code Files

- Modify: `package.json`, `.github/workflows/ci.yml`, `README.md`, `Makefile`
- Create: `scripts/test-token-stack.ps1`, `docs/token-stack-testing.md`,
  `plans/260903-1904-token-stack-comprehensive-test-strategy/reports/qa-baseline.md`

## Implementation Steps

1. Add `test:token-stack`, `test:token-stack:coverage`, and optional
   `test:token-stack:live` commands; default `test` remains scoped as currently
   documented or is renamed only with documentation migration.
2. Run the offline job on Windows (PowerShell is a public surface) and one
   portable Node environment if supported; cache dependencies but not test state.
3. Produce a QA baseline report: totals, duration, coverage by core module,
   skipped live cases, external-tool availability, and any remaining gaps.
4. Add a required static secret scan and enforce redaction on generated reports.
5. Document contributor commands, expected prerequisites, isolation guarantees,
   live-test opt-in, and troubleshooting; update README/Makefile only for the
   user-visible command contract.
6. Demonstrate gate integrity by intentionally failing one assertion in a
   disposable branch/worktree and confirming CI exits non-zero, then restore it.

## Todo

- [x] CI status distinguishes test failure, environment skip, and unavailable optional tool.
- [x] Documentation points to a single canonical Token-Stack test command.

## Success Criteria

- [x] A clean checkout can execute the offline Token-Stack gate without global installation or user configuration.
- [x] Critical safety contracts are required tests and all reports are redacted.

## Risk Assessment

Coverage can look healthy while CLI and security paths remain untested. Signal:
aggregate threshold passes but the critical-path checklist has blanks. Response:
fail the gate on missing mandatory scenarios independently of percentage.
