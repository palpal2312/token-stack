---
phase: 1
title: "Baseline and Safety Contract"
status: pending
priority: P1
effort: "4-6h"
dependencies: []
---

# Phase 1: Baseline and Safety Contract

## Overview

Establish what the current tests actually execute, which state they touch, and
the exact offline-versus-live contract before rewriting the harness.

## Requirements

- Functional: inventory every `tests/*.cjs`, each core export, each PowerShell
  command, and every external dependency (filesystem, global command, port,
  process, provider).
- Non-functional: do not execute mutation-prone setup or live verifier tests
  against the developer profile during discovery.
- Security: record only secret presence/absence and variable names; never copy
  credentials, profile content, or provider responses into tests or reports.

## Architecture

Create a test manifest that labels each test `unit`, `integration-offline`, or
`live-opt-in`, plus its allowed filesystem root, ports, commands, and network
policy. The manifest becomes the review checklist for all later phases.

## Related Code Files

- Modify: `package.json`, `tests/test-all-layers.cjs`
- Create: `tests/test-manifest.md`, `tests/fixtures/`
- Inspect: `core/*.cjs`, `core/*.ps1`, `bin/token-stack.ps1`,
  `skills/token-stack-setup/scripts/token-stack-setup.ps1`,
  `.github/workflows/ci.yml`

## Implementation Steps

1. Run only read-only inventory commands; do not use the existing aggregate
   runner because its setup/cache behavior can affect user state.
2. Record existing assertions, untested public branches, and integration seams.
3. Define environment variables for an injected test root, registry path,
   command path, and network mode; default all to temporary/local values.
4. Add a baseline command that fails when a test writes outside its allocated
   root or opens an external socket in offline mode.

## Todo

- [x] Publish the test manifest and fixture ownership rules.
- [x] Document baseline limitations rather than reporting an unexecuted suite as passing.

## Success Criteria

- [x] Every existing suite is classified with its side effects and replacement target.
- [x] Default test policy is explicit: no user profile, global CLI, external network, or daemon lifecycle.

## Risk Assessment

Tests may already have changed durable user cache/profile state. Signal:
unexpected files appear outside the test root. Response: stop the run, locate
the code path, add dependency injection, and clean only artifacts created by
the test after confirming their exact paths.
