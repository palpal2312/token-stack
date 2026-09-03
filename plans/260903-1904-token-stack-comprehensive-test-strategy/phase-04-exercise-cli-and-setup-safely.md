---
phase: 4
title: "Exercise CLI and Setup Safely"
status: pending
priority: P1
effort: "8-10h"
dependencies: [2, 3]
---

# Phase 4: Exercise CLI and Setup Safely

## Overview

Test the PowerShell command dispatcher, registry helpers, setup script, and
three-stage verifier through controlled local seams, with a strict boundary
between offline and live behavior.

## Requirements

- Functional: every documented dispatcher subcommand has help, valid-input,
  invalid-input, exit-code, and output-contract coverage; registry schema
  errors name the invalid field without leaking profile values.
- Security: delete any embedded authentication fallback; credentials are read
  only from injected runtime state for opt-in live tests and never rendered.
- Operational: `up`, `down`, and live verifier tests use a fake process/listener
  by default and must never kill user-owned processes.

## Architecture

Offline integration tests call `bin/token-stack.ps1` via a repository-local
PowerShell invocation with a temporary registry and fake executables. A local
HTTP test server emulates `/readyz` and streamed responses. The live verifier
is a separately named command, disabled unless an explicit environment switch
and non-empty credential reference are supplied.

## Related Code Files

- Modify: `bin/token-stack.ps1`, `core/registry.ps1`, `core/port-allocator.ps1`,
  `core/verifier.ps1`, `skills/token-stack-setup/scripts/token-stack-setup.ps1`
- Replace/migrate: `tests/cli-e2e.test.cjs`, `tests/setup.test.cjs`
- Create: `tests/integration/cli.test.cjs`, `tests/integration/setup.test.cjs`,
  `tests/integration/verifier.test.cjs`, `tests/helpers/fake-proxy.cjs`

## Implementation Steps

1. Test `help`, unknown command, dispatcher argument parsing, and every
   read-only command against fixtures; assert exit codes, not console wording alone.
2. Test registry path/schema/profile validation and port allocation using
   temporary sockets; prove collision and release handling.
3. Refactor setup so all outputs are under its injected home/profile paths;
   test dry-run, apply, idempotency, malformed settings backup, permission
   failure, and cleanup without touching the actual profile.
4. Replace global-CLI smoke with a repository-local process test; make any CLI
   execution failure a test failure.
5. Test verifier state matrix: proxy down, no credential, provider auth/error,
   valid synthetic stream, malformed stream, and timeout. Preserve SKIP as a
   distinct verdict, not PASS.
6. Add an offline scan/assertion prohibiting embedded secret-shaped literals in
   source and test fixtures; use test-only placeholders that cannot authenticate.

## Todo

- [x] No default test starts/stops a real daemon or sends a provider request.
- [x] Live test receipt is redacted and clearly says PASS, FAIL, or SKIP with cause.

## Success Criteria

- [x] Repository-local CLI integration is deterministic on a clean Windows runner.
- [x] Setup and verifier behavior is covered without profile mutation or secret disclosure.

## Risk Assessment

PowerShell error handling can return success after a nested command failure.
Signal: a fake child returns non-zero while the parent test passes. Response:
capture `$LASTEXITCODE`, force `ErrorActionPreference=Stop`, and test the
failure path first.
