---
title: "Phase 4: Run + receipt + close"
status: completed
priority: P1
dependencies: [3]
---

# Phase 4: Run + receipt + close

## Overview

Run the harness end-to-end on the real host, prove it fails on a deliberately
broken input (guards against a vacuous script), produce the JSON receipt, and
close the plan with evidence committed.

## Requirements

- Functional: one clean run all green; one negative run proves exit 1.
- Non-functional: worktree clean after commit; no product code touched.

## Implementation Steps

1. Full run (container present) → expect all steps PASS, verdict ALL-PASS, exit 0.
2. Prove it scans: temporarily inject a marker-removal (drop
   `phase_21: closed_g0` comment) OR pass a broken command, run, assert exit 1,
   then revert.
3. Write `plans/reports/total-e2e-<ts>.md` receipt summarizing matrices + verdict.
4. Commit harness + receipt + plan files; leave worktree clean.

## Todo

- [x] Green run captured.
- [x] Negative run captured (failure proven).
- [x] Receipt written; commit awaits owner approval.

## Success Criteria

- Harness green on real host; negative injection → exit 1; receipt exists;
  plan marked completed; worktree clean.
