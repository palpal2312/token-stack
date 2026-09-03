---
phase: 2
title: "Isolate Test Runtime"
status: pending
priority: P1
effort: "6-8h"
dependencies: [1]
---

# Phase 2: Isolate Test Runtime

## Overview

Introduce a repeatable Node test harness and dependency seams so all offline
tests run in a disposable directory and never depend on machine installation.

## Requirements

- Functional: replace ad-hoc direct execution with `node --test`; provide a
  shared fixture helper that creates and removes a unique test root.
- Non-functional: tests may run in parallel without port, file, cache, or
  environment collisions; cleanup runs on assertion failure.
- Compatibility: preserve the public CLI command names and existing core APIs
  unless a testability-only optional dependency parameter is required.

## Architecture

`tests/helpers/test-environment.cjs` owns a temporary root and exposes child
environment variables. Core constructors receive explicit paths/options;
PowerShell receives `-ProfileDirectory`, registry-path override, and a
repository-local CLI path. A fake command directory precedes PATH for process
tests; no host-global command is consulted.

## Related Code Files

- Create: `tests/helpers/test-environment.cjs`, `tests/helpers/run-pwsh.cjs`,
  `tests/fixtures/registry.valid.json`, `tests/fixtures/registry.invalid.json`
- Modify: `core/semantic-cache.cjs`, `core/data-lens.cjs`, `core/registry.ps1`,
  `tests/test-all-layers.cjs`, `package.json`
- Replace/migrate: `tests/*.test.cjs`

## Implementation Steps

1. Add `npm run test:token-stack` and separate scripts for unit and offline
   integration tests; make aggregate exit status authoritative.
2. Change cache and setup dependencies to consume only explicit test paths in
   test mode; assert that HOME/USERPROFILE remain unmodified.
3. Create fake `duckdb`, `clickhouse`, `curl`, and CLI command adapters with
   deterministic stdout, exit code, timeout, and error cases.
4. Make test cleanup provenance-aware: remove only the newly created test root.
5. Prove parallel isolation by executing two fixtures with distinct homes and
   asserting no shared entries or port collisions.

## Todo

- [x] Test process passes from a non-installed CLI environment.
- [x] Failure injection still yields a non-zero test command.

## Success Criteria

- [x] Running the offline suite twice produces the same verdict and leaves no durable user-state changes.
- [x] Test files use structured Node test cases, not success-only console messages.

## Risk Assessment

PowerShell inherits environment state differently from Node. Signal: an
artifact is written to the real profile or a fake executable is bypassed.
Response: pass an explicit child environment, assert it in a probe command,
and prohibit fallback to default paths in test mode.
