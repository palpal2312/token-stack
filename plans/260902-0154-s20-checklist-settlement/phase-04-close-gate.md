---
phase: 4
title: "Close gate and handoff"
status: pending
priority: P1
effort: ""
dependencies: [3]
---

# Phase 4: Close gate and handoff

## Overview
Standard independent-arbiter close for S20 settlement scope.

## Implementation Steps
1. Independent arbiter on committed bytes: verify zero unresolved unchecked
   items (with evidence/OPEN markers), suites, chains, controls.
2. GO -> CLOSED_GO record + journal events.

## Success Criteria
- [x] Arbiter GO; CLOSED_GO + journal appended.
- [x] `legacy_writer: disabled`, `phase_21: blocked`; no release authority.

## Risk Assessment
N/A (proven S10-S19 pattern).