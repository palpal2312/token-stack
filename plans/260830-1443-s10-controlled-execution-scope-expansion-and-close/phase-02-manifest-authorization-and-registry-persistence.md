---
title: "Phase 2: Manifest authorization and registry persistence"
status: todo
---

# Phase 2: Manifest authorization and registry persistence

## Overview

Define and implement privacy-safe immutable signal, candidate, evidence, evaluation-run, canary, promotion, rollback, and supersession records behind explicit approval boundaries.

## Requirements

- [x] Registry schema is versioned, idempotent, redacted, and replayable. (_evidence: see CLOSED_GO record)
- [x] Writes require approved scope and cannot reactivate legacy authority or Phase 21. (_evidence: see CLOSED_GO record)
## Implementation Steps

1. Map existing persistence and DTO ownership; move shared surfaces to integration owner.
2. Implement registry records and duplicate/supersession constraints.
3. Add migration, security, and idempotency tests with rollback evidence.

## Todo

- [x] Registry receipt and schema hash (_evidence: see CLOSED_GO record)
- [x] Migration/rollback test receipt (_evidence: see CLOSED_GO record)
## Success Criteria

- [x] All record types have current-byte schema and test evidence. (_evidence: see CLOSED_GO record)
- [x] No private content, secret, prompt, source, or personal data is persisted. (_evidence: see CLOSED_GO record)