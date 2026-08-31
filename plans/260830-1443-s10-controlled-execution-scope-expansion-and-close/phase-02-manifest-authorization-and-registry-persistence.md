---
title: "Phase 2: Manifest authorization and registry persistence"
status: todo
---

# Phase 2: Manifest authorization and registry persistence

## Overview

Define and implement privacy-safe immutable signal, candidate, evidence, evaluation-run, canary, promotion, rollback, and supersession records behind explicit approval boundaries.

## Requirements

- [ ] Registry schema is versioned, idempotent, redacted, and replayable.
- [ ] Writes require approved scope and cannot reactivate legacy authority or Phase 21.

## Implementation Steps

1. Map existing persistence and DTO ownership; move shared surfaces to integration owner.
2. Implement registry records and duplicate/supersession constraints.
3. Add migration, security, and idempotency tests with rollback evidence.

## Todo

- [ ] Registry receipt and schema hash
- [ ] Migration/rollback test receipt

## Success Criteria

- [ ] All record types have current-byte schema and test evidence.
- [ ] No private content, secret, prompt, source, or personal data is persisted.
