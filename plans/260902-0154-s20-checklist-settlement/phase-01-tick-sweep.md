---
phase: 1
title: "Tick-sweep (evidence-linked, files-only)"
status: pending
priority: P1
effort: ""
dependencies: []
---

# Phase 1: Tick-sweep (evidence-linked, files-only)

## Overview
Mark every DONE-evidence checklist item as satisfied with its CLOSED_GO/verdict/
receipt reference; make phase statuses consistent. No product-code or authority
change.

## Requirements
- Functional: ~103 items ticked with a source reference line.
- Non-functional: files-only edits in `plans/`; no commit by the sweeper unless
  requested.

## Related Code Files
- Modify: plans/*/plan.md + phase-*.md under S10,S11,S12,P12,S13,S15,S16,S17,S18.

## Implementation Steps
1. Use the audit ledger (`checklist-audit-260902-s10-s19.md`) as the picks list.
2. For each DONE item: `- [x]` + `(_evidence:_ <path>)`.
3. For OPEN items: leave `- [ ]` and append `(OPEN: <owner|external|plan-ref>)`.
4. Update phase frontmatter status=completed where all its items settled.

## Success Criteria
- [ ] No unchecked item without an evidence link or OPEN marker.
- [ ] Phase statuses consistent.

## Risk Assessment
Accidental over-tick — mitigation: only tick items the ledger classifies DONE,
cross-check the referenced verdict exists.