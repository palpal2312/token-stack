---
phase: 6
title: "Installer, Packaging, and Compatibility"
status: complete
priority: P1
effort: "1.5-2d"
dependencies: [1, 4]
---

# Phase 6: Installer, Packaging, and Compatibility

## Overview

Certify the shipped file set, clean install, relocation, upgrade/rollback, generated wrappers, and declared Node/PowerShell support without relying on the developer checkout.

## Requirements

- Test both current installer surfaces until one is explicitly designated authoritative.
- Install only into a temp prefix/profile with repository-root injection unset for the installed smoke.
- Compatibility claims must match green CI evidence; unsupported shells/platforms are explicit.

## File Inventory

| Action | File | Purpose / test impact |
|---|---|---|
| Create | `tests/token-stack/installer-compat.test.cjs` | Clean/upgrade/failure/rollback cases |
| Create | `tests/token-stack/package-layout.test.cjs` | Shipped manifest, relocation, machine-path scan |
| Create | `tests/token-stack/fixtures/install-profiles/` | Empty/valid/malformed/partial/older profiles |
| Create | `scripts/test-token-stack-compat.ps1` | Shell/runtime matrix entrypoint |
| Modify | `.github/workflows/ci.yml` | Characterization/required compatibility jobs |
| Conditional | `scripts/install-token-stack.ps1` | Add named failpoints; restore overwritten skills/env/hooks/settings on rollback |
| Conditional | `skills/token-stack-setup/scripts/token-stack-setup.ps1` | Add same failpoint protocol; align owner or expose divergence |
| Inspect | `package.json`, `Makefile`, `skills/token-stack*/SKILL.md` | Declared runtime and shipped contract |

## Test Scenario Matrix

| Dimension | Cases | Oracle |
|---|---|---|
| Checkout/prefix | spaces, Unicode, relocated root, read-only source | wrappers resolve installed assets; no absolute developer path |
| Profile | empty, valid, malformed/wrong type, partial, old install | preserve unrelated state; deterministic backup/migration |
| Install mode | dry-run, apply, reinstall, upgrade | zero-write dry-run; idempotent apply; verified rollback |
| Failure | missing Node/source/plugin, denied write, named failpoint before/after each boundary | exact per-target oracle: untouched target byte-identical; replaced target restored byte-identical; newly created target absent; documented corrupt-input backup retained |
| Shell/runtime | Windows PowerShell 5.1; pwsh 7 characterization; Node 24 | support table equals evidence |
| Installed CLI | help, offline verify, invalid command, setup dry-run | works via PATH with `TOKEN_STACK_REPO_ROOT` unset |

## Function / Interface Checklist

- [ ] Installer/setup parameters, shared named-failpoint protocol, dry-run/apply exit codes, backups, rollback, optional component policy.
- [ ] Generated `.ps1`/`.cmd` wrappers and repository/core resolution.
- [ ] Package manifest contains all required core, bin, skill, and script files only.
- [ ] Settings/plugin/upstream/port values preserve user-owned unrelated fields.
- [ ] Node 24 and shell version are captured in every receipt.

## Dependency Map

```text
phase 1 sandbox + phase 4 CLI/setup -> staged package/install -> relocated PATH smoke -> phase 8 CI support table
```

## Implementation Steps

1. Define the exact shipped file manifest and compare the two installer contracts.
2. Stage a clean copy/install under paths with spaces/Unicode; unset checkout-only env and invoke wrapper via PATH.
3. Run dry-run, apply, reapply, upgrade, malformed-profile, missing-component, and denied-write cases.
4. Inject named failures before and after every mutation boundary in both installers. Verify exact restoration of overwritten skill trees, environment files, hooks, settings and wrappers; remove only newly created owned targets; retain only documented corrupt-input backups.
5. Run the declared shell/runtime matrix; mark extra platforms characterization until adopted.

## Success Criteria

- [ ] Clean and relocated installs pass help/offline verify/dry-run; invalid command is nonzero.
- [ ] Reinstall is idempotent; every named failpoint satisfies its exact per-target byte-equivalent restoration/removal oracle.
- [ ] Installed artifacts contain no local developer path or credential-shaped value.
- [ ] Compatibility documentation contains no platform/shell claim without a required green job.

## Risk Assessment And Rollback

The two installers currently diverge and legacy rollback may be destructive. Do not declare equivalence. If choosing one owner requires product approval, keep both results separately reported and block only the unapproved consolidation.

## Todo

- [x] Define shipped manifest and installer ownership.
- [x] Prove clean/relocated installed CLI.
- [x] Prove idempotent upgrade and rollback.
- [x] Publish evidence-backed compatibility table.
