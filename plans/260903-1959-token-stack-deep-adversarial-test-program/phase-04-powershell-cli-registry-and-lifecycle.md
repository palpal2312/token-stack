---
phase: 4
title: "PowerShell CLI, Registry, and Lifecycle"
status: complete
priority: P1
effort: "2-3d"
dependencies: [1]
---

# Phase 4: PowerShell CLI, Registry, and Lifecycle

## Overview

Exercise repository-local PowerShell command routing, registry persistence, port allocation, setup transitions, and test-owned process lifecycle under concurrency and failure.

## Requirements

- Test direct functions and CLI process boundaries with temp profiles/registries and fake executables.
- Preserve `down` fail-closed behavior until verifiable ownership exists.
- Invalid use returns stable nonzero exit; no quoting injection or user-state fallback.

## File Inventory

| Action | File | Purpose / test impact |
|---|---|---|
| Create | `tests/token-stack/powershell-cli.test.cjs` | Dispatcher/args/exit/stdout-stderr contracts |
| Create | `tests/token-stack/registry-port.test.cjs` | Schema, atomicity, concurrency, port races |
| Create | `tests/token-stack/setup-install.test.cjs` | Dry-run/apply/idempotency/failure boundaries |
| Create | `tests/token-stack/process-lifecycle.test.cjs` | Owned start/readiness/stop/foreign refusal |
| Create | `tests/token-stack/fixtures/fake-headroom.ps1` | Scripted ready/crash/hang proxy |
| Modify | `tests/token-stack/integration.test.cjs` | Split existing cases into focused suites |
| Conditional | `bin/token-stack.ps1`, `core/registry.ps1`, `core/port-allocator.ps1` | Fix only proven exit/atomicity/ownership defects |
| Conditional | `skills/token-stack-setup/scripts/token-stack-setup.ps1`, `scripts/install-token-stack.ps1` | Add matching named failpoints and transaction/restore seams |

## Test Scenario Matrix

| Surface | Happy | Edge / failure / security |
|---|---|---|
| CLI | help/status/test/profile/data/quant/cache/skill/verify/setup | unknown/missing args, Unicode/space paths, metacharacters, child nonzero |
| Registry | create/read/update/remove | missing/BOM/malformed/wrong schema, missing parent, concurrent 8-32 writers, crash mid-write |
| Ports | free/reserved/occupied | exhaustion, TOCTOU bind race, release/rebind |
| Setup | dry-run/apply/reapply | wrong-type settings, read-only target, interruption after each write, backup recovery |
| Lifecycle | delayed-ready start and owned stop | missing binary, early crash, never-ready, stale/PID reuse, foreign listener/process |

## Function / Interface Checklist

- [ ] CLI parameters, every documented command, invalid usage, and `$LASTEXITCODE` propagation.
- [ ] Registry path precedence plus `Get/Save/GetProfile/SetProfile/RemoveProfile/Ensure-ProfileDbDirectory`.
- [ ] `Test-TcpPortFree` / `Find-FreeHeadroomPort`, including reserved/exhausted/race cases.
- [ ] Both installer parameter sets, dry-run zero-write, apply, malformed backup, idempotence, named failpoints, rollback.
- [ ] Ownership identity: PID, start time, normalized executable, args, profile, port, run ID.

## Dependency Map

```text
phase 1 harness -> CLI/registry/port characterization -> setup failpoints + lifecycle ownership -> phases 5, 6, 7
```

## Implementation Steps

1. Convert every documented command and invalid form into an exit/output contract test.
2. Add schema/malformed/atomic registry tests and parallel writer scenarios.
3. Bind listeners first for port tests; inject the bind race rather than relying on chance.
4. Define named failpoints before/after each mutation boundary in both installer surfaces. Snapshot setup targets around dry-run/apply/interruption; restore overwritten skill trees, environment/hook files, settings, wrappers, and other pre-existing targets.
5. Implement process tests only through the ownership harness; repeat start/readiness/stop 20 times and force failure mid-cycle.

## Success Criteria

- [ ] Full command matrix passes from a scrubbed temp profile; invalid use is nonzero and secret-free.
- [ ] Concurrent registry run yields valid JSON, no lost update, unique ports, and no partial file.
- [ ] Dry-run is byte-identical; second apply has no semantic diff; every named failpoint restores replaced targets byte-identically, removes newly created owned targets, and retains only the documented corrupt-input backup.
- [ ] 20 lifecycle cycles leave zero child/listener; stale/foreign/PID-reused targets are never terminated.

## Risk Assessment And Rollback

Current `up` cannot prove ownership. Do not weaken `down` or test via global name matching. If safe ownership requires product design beyond test seams, keep lifecycle characterization blocked and document the explicit prerequisite.

## Todo

- [x] Complete CLI command/exit matrix.
- [x] Prove registry atomicity/concurrency and port race handling.
- [x] Prove setup transaction/idempotence.
- [x] Prove owned lifecycle and foreign-process refusal.
