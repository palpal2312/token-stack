---
phase: 1
title: "Hermetic Harness and Failure Model"
status: complete
priority: P1
effort: "1.5-2d"
dependencies: []
---

# Phase 1: Hermetic Harness and Failure Model

## Overview

Make isolation, deadlines, ownership, and cleanup mechanically testable before adding high-volume or stateful suites. Close import-time user-profile access and hanging child-process risks.

## Requirements

- Unique sandbox for home/profile/appdata/cache/registry/bin/logs; loopback-only network; owned child/server tracking.
- Cleanup in `finally`, per-child and suite deadlines, reproducible receipts, no inherited secret-bearing environment.
- Importing core modules cannot scan or read a real user home during tests.

## Architecture

`run-tests.cjs` creates a run sandbox and allowlisted environment. Helpers own filesystem snapshots, loopback servers, child process trees, deadlines, and cleanup receipts. Production imports use explicit dependencies or a test-safe lazy default.

## File Inventory

| Action | File | Purpose / test impact |
|---|---|---|
| Create | `tests/token-stack/environment-contract.test.cjs` | Filesystem/env/network/process canaries |
| Create | `tests/token-stack/helpers/network-harness.cjs` | Loopback scripted faults and close/rebind proof |
| Create | `tests/token-stack/helpers/process-harness.cjs` | PID/start-time/path/args/run-id ownership |
| Create | `tests/token-stack/helpers/filesystem-snapshot.cjs` | Protected-root before/after snapshots |
| Create | `tests/token-stack/fixtures/README.md` | Fixture provenance and secret-free rules |
| Modify | `tests/token-stack/helpers.cjs`, `tests/token-stack/run-tests.cjs` | Scrub env, errors, deadlines, receipts |
| Modify | `tests/test-manifest.md` | Allowed roots, ports, commands, time budgets |
| Conditional | `core/semantic-cache.cjs`, `core/skill-router.cjs` | Remove/lazily construct import-time host probing |

## Test Scenario Matrix

| Class | Scenarios | Oracle |
|---|---|---|
| Happy | temp cache/profile/registry; child exits; server closes | owned resources cleaned |
| Boundary | spaces, Unicode, long path; ephemeral port; empty env | no fallback to host state |
| Error | missing executable, spawn error, read-only dir, timeout, reset | bounded nonzero; cleanup still runs |
| Security | canary outside temp root; non-loopback socket attempt | deliberate escape is detected |
| Repetition | 20 full harness cycles | zero drift, flakes, listeners, child PIDs |

## Function / Interface Checklist

- [ ] `withTempDir()` handles sync/async failure and validates deletion target.
- [ ] `runPowerShell()` / `runPowerShellAsync()` handle shell selection, spawn error, timeout, owned-tree kill, exit propagation.
- [ ] `SemanticCache` / `SkillRouter` imports avoid real user state.
- [ ] Env allowlist covers home/appdata/config/registry/cache/root overrides.
- [ ] Network harness records destination without credentials.

## Dependency Map

```text
existing runner -> sandbox/env -> process + network + fs guards -> phases 2, 4, 5, 6, 7
```

## Implementation Steps

1. Capture clean baseline; retain aggregate hang as a defect until isolated.
2. Build allowlisted env and protected-root snapshots; prove the guard with a violating fixture.
3. Add subprocess error/timeout/tree-kill and listener close/rebind verification.
4. Remove import-time host state access with the smallest compatible seam.
5. Execute 20 repetitions with injected assertion failure and timeout.

## Success Criteria

- [ ] 20/20 runs: zero external socket, outside-root write, orphan PID, or bound fixture port.
- [ ] Per-test 10s, integration child 15s, full offline budget 60s on `windows-latest`, unless evidence revises it.
- [ ] Deliberate filesystem/network/process escape fixtures fail the gate.

## Risk Assessment And Rollback

PowerShell editions expose different errors. Assert exit/resource invariants, not native wording. Keep new instrumentation opt-in until canaries are stable; if one false-positives, disable only that sensor while keeping deadlines and cleanup.

## Todo

- [x] Establish sandbox and environment contract.
- [x] Establish network/process/filesystem ownership guards.
- [x] Remove import-time host probing under tests.
- [x] Prove cleanup under pass, failure, spawn error, and timeout.
