---
phase: 3
title: "Cutover, verify and rollback drill"
status: pending
priority: P1
effort: ""
dependencies: [2]
---

# Phase 3: Cutover, verify and rollback drill

## Overview
Switch the canonical path live (the `legacy_writer: enabled` step ONLY as the
final gate action), write-verify, and prove rollback.

## Implementation Steps
1. Record freeze; enable canonical as sole writer (the single recorded gate step).
2. Write-verification: new adapter canonical; old surface inert.
3. Rollback drill: on a forced failure, restore prior state + NO_GO receipt.

## Success Criteria
- [ ] Write-verification PASS; rollback drill PASS; any failure → NO_GO.
