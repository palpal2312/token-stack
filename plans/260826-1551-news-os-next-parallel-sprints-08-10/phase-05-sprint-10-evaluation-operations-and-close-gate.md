---
title: "Closeout and release-readiness evidence"
status: todo
---

# Closeout and release-readiness evidence

## Overview

Package the controller handoff and release-readiness evidence without performing command-authority cutover.
## Related Code Files

- `plans/reports/`
- `plans/handoffs/`
- `plans/scripts/`
- `docs/orchestration-runbook.md`

## Requirements

- [ ] Publish plan status, run manifest, lane receipts, arbiter verdicts, and unresolved-risk ledger.
- [ ] Publish forecast-calibration evidence, snapshot version/signature inventory, and estimate-versus-actual acceptance evidence without private Run content.
- [ ] Confirm no unapproved worker assignment, orphan process, legacy-writer flag, or Phase 21 transition remains.
- [ ] Keep all handoff artifacts redacted and portable.

## Implementation Steps

1. Reconcile Orca, repository, tests, reports, and active-plan state.
2. Verify all links and hashes in the close packet.
3. Write a redacted handoff for the next controller with the exact next gate and fallback.

## Success Criteria

- [ ] Handoff contains no secrets or raw MemoraX transcripts.
- [ ] Release-readiness is clearly distinguished from release execution.
- [ ] Close evidence distinguishes demonstrated forecast accuracy from product promise and records low-confidence/out-of-distribution limitations.
- [ ] Next controller can resume from evidence without guessing state.

## Risk Assessment

Stale reports can create false closure. Mitigate by checking live Orca state and repository bytes immediately before handoff.
