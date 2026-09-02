---
phase: 4
title: "Sprint 07 Home SEN open-source maintainer"
status: pending
priority: P1
effort: "32-36 agent-hours; <=48h sprint timebox"
dependencies: [1]
---

# Phase 4: Sprint 07 Home SEN open-source maintainer

## Overview

Give Home SEN a local, risk-bounded maintenance workflow: inventory, diagnose,
checkpoint, repair, verify, rollback and preserve a sanitized local recipe.

## Start gate

Tool inventory and repair contracts may start after `S05-G1`; final GO waits for
Sprint 05 GO so all evidence binds to stable Home SEN identity and scope.

## Requirements

- Inventory installed open-source tools, versions, capabilities and health.
- Classify incidents and propose a repair inside a pre-approved risk envelope.
- Checkpoint before mutation; verify outcome; rollback failed/unverified repair.
- Learn structured local recipe outcomes without retaining raw private data.
- Community escalation/upload remains Sprint 08/09 scope and is not implemented.

## Architecture

Lane 1 owns inventory/health/recipe explanations. Lane 2 owns fingerprints,
incident taxonomy, checkpoints and evidence. Lane 3 owns repair policy,
verification/rollback, poisoning defense and failure injection.

## Related code files

- Create: `go/internal/maintainer/**`
- Create: `src/lib/maintainer/**`
- Create: `src/app/api/sen/maintenance/**`
- Create: `qa/fixtures/sprint07/**`
- Read only: Home/Project SEN contract, existing Orca/tool health evidence

## Implementation steps

1. Consume hash-pinned S05 Home identity and privacy scope.
2. Build normalized tool/version/capability and environment fingerprint models.
3. Build incident classification and checkpoint evidence contract.
4. Implement bounded propose/approve/repair/verify/rollback state machine.
5. Add poisoning, unsafe-command, partial-failure and rollback fixtures.
6. Preserve sanitized local recipe statistics only.
7. Wait for Sprint 05 GO, then promote and run independent Sprint 07 arbiter.

## Todo

- [ ] S07 logical lanes prepared with ACTIVE/NEXT/FALLBACK. (OPEN: historical plan dir; see roadmap track record)
- [ ] Inventory and deterministic fingerprint gates pass. (OPEN: historical plan dir; see roadmap track record)
- [ ] Risk-envelope approval and checkpoint gates pass. (OPEN: historical plan dir; see roadmap track record)
- [ ] Failed or unverifiable repair rolls back. (OPEN: historical plan dir; see roadmap track record)
- [ ] Poisoned/untrusted recipe is rejected. (OPEN: historical plan dir; see roadmap track record)
- [ ] No community upload or Phase 21 artifact exists. (OPEN: historical plan dir; see roadmap track record)
- [ ] Independent Sprint 07 arbiter returns GO. (OPEN: historical plan dir; see roadmap track record)

## Success criteria

Safe repair proves its outcome and leaves an auditable local recipe; unsafe or
unverified repair blocks or rolls back with an exact reason.

## Risk assessment

OS/tool mutation can be destructive. Begin with fixtures and disposable scopes;
live mutation requires explicit approval and a verified rollback checkpoint.

## Security considerations

Commands, recipes and tool metadata are untrusted input. Apply allowlists,
taint tracking, bounded outputs and secret redaction before evidence storage.
