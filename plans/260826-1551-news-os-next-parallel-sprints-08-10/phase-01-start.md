---
title: "Sprint 08 shared gate and parallel lane contracts"
status: todo
---

# Sprint 08 shared gate and parallel lane contracts

## Overview

Freeze the common contracts and operational boundaries needed to run Sprint 08-A and Sprint 08-B concurrently after Sprint 05-07 close.

## Requirements

- [ ] Confirm Sprint 05-07 is `closed_go` and its receipts/manifests are the baseline.
- [ ] Map dependencies to master phases 8-12 and mark unfinished historical plans as non-authoritative.
- [ ] Freeze versioned DTOs, event names, provenance fields, error envelopes, and migration ownership.
- [ ] Freeze `Run Learning Record`, `Forecast Feature Record`, `Contribution Candidate`, `Community Knowledge Snapshot`, forecast-result, and calibration-error contracts.
- [ ] Freeze forbidden fields covering prompt, conversation, code, diff, repository/project identity, path, raw log, secret, credential, and personal data.
- [ ] Assign disjoint file/worktree/report ownership to three Sprint 08 lanes plus one shared migration/DTO integration owner.
- [ ] Record explicit rollback boundaries; legacy writers remain disabled.

## Architecture and ownership

Shared gate owns only contracts, forbidden-field policy, dependency ledger, lane manifests, shared registration, and reports. It does not own feature implementation.

## Related Code Files

- `README.md`
- `docs/system-architecture.md`
- `docs/orchestration-runbook.md`
- `plans/reports/orchestrate-260825-sprint05-07-multi-sprint/`

## Implementation Steps

1. Read the current README, architecture/runbook docs, Sprint 05-07 close evidence, and relevant master phase documents.
2. Produce a three-lane manifest with owners, allowed paths, dependencies, tests, budgets, and fallback work.
3. Validate compatibility against `src/`, `go/`, and existing verification scripts without changing feature code.
4. Have the controller and independent arbiter approve the start gate in Orca.

## Success Criteria

- [ ] A gate receipt records all dependencies and ownership.
- [ ] No producer write set overlaps among S08-A, S08-B, and S08-C; shared registrations have one integration writer.
- [ ] All workers have bounded ACTIVE/NEXT/FALLBACK assignments.
- [ ] Contract fixtures prove forbidden private fields cannot enter contribution or community snapshot payloads.
- [ ] Any missing prerequisite is explicitly blocked rather than silently assumed.

## Risk Assessment

The main risk is a shared contract or migration being edited by both lanes. Mitigate with one contract owner, disjoint worktrees, and current-byte verification before integration.
