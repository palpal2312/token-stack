---
phase: 1
title: "Freeze source candidates and reconcile evidence"
status: in-progress
priority: P1
effort: "1h"
dependencies: []
---

# Phase 1: Freeze source candidates and reconcile evidence

## Overview

Settle in-flight C2, C3, and C5 work without retrying ambiguous dispatches.
Produce a coherent evidence baseline before any new promotion work.

## Requirements

- [ ] Inspect exact assigned Orca terminals and bounded file deltas before any retry.
- [ ] Accept C2 only from its committed source receipt and receipt verifier.
- [ ] Accept C3 only after its three-file commit, current source hashes, and receipt verifier agree.
- [ ] Reconcile C1 promotion receipt and its three master path hashes as manifest inputs.
- [ ] Accept C5 only as a candidate; it cannot claim master current-byte coverage.
- [ ] Preserve Contract v1 hashes and the contract-only arbiter report as immutable inputs.

## Implementation Steps

1. Lane B finalizes or verifies the C3 three-file source candidate; record its commit and receipt.
2. Lane A records the C2 source commit/receipt as the I4 input.
3. Lane C records a C5 candidate matrix with pending master fields explicitly blank.
4. Controller reconciles Orca task, exact terminal, source bytes, and receipt for each lane.
5. Lane A records a pre-integration baseline: HEAD/tree hash, staged pathname set hash/count, index hash/count, status snapshot, and six destination preimages.

## Todo

- [ ] C2 source candidate is immutable and independently hash-verified.
- [ ] C3 source candidate is immutable and independently hash-verified.
- [ ] C5 candidate does not contain a synthetic PASS or stale master hashes.
- [ ] C1/I3 master evidence and the dirty-index baseline are preserved for later comparison.
- [ ] Each lane has a prepared next assignment and fallback.

## Success Criteria

- Every next phase has one named input commit/receipt, not an inferred terminal state.
- No duplicate writer exists after an ambiguous prompt result.

## Risk Assessment

If a task row says ready/failed but its terminal has produced valid files, use
the receipt and bounded terminal/file reconciliation; do not blindly redispatch.
