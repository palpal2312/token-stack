---
phase: 4
title: "Close gate — independent arbiter + CLOSED_GO"
status: pending
priority: P1
effort: ""
dependencies: [2, 3]
---

# Phase 4: Close gate — independent arbiter + CLOSED_GO

## Overview
Standard S10-S16 independent-arbiter close: prove the observability commitment
on committed bytes with the probes armed and recording, then record CLOSED_GO
and preserve the S16/S17 gates. Observability grants no release — the gate
proves the harness exists, is armed, and does what it says.

## Requirements
- Functional: an independent fresh-session arbiter (not the plan/probe author)
  re-executes the S18 gates on committed bytes (clone/checkout, not working
  tree).
- Non-functional: same evidence discipline as S10-S16 — scrub bearer-like
  values and secrets from any receipt (ops-prep §1g), keep runtime state
  (metrics dir, probe task state) out of the product branch (S11 merge-hygiene
  lesson), no release scope.

## Architecture
N/A — process phase, no new component.

## Related Code Files
- Read: `docs/newsos-master-memory.md` (S16 close pattern, merge hygiene, S18
  checkpoint to append), prior CLOSED_GO records under `plans/reports/`
  (e.g. `s17-CLOSED_GO-record.md`), Finalize/controller-failover state.
- Arbiter inputs: `scripts/s18-slo-probes.ps1`, `scripts/s18-backup-cadence.ps1`,
  `scripts/install-s18-probe-task.ps1`, the dashboard route/page, and the metrics
  receipt lines on the local host.

## Implementation Steps
1. Full gate re-run on committed bytes: `scripts/test-s18-slo-probes.ps1` passes,
   `-RunOnce` emits all four families, `-SelfCheck` archive shows the injected
   alert, dashboard route returns the series, backup cadence receipt is current,
   probe scheduled task LastRunTime is fresh.
2. Evidence hygiene: confirm no metric/probe output paths (`%LOCALAPPDATA%\
   NEWSOS`, scheduled-task state) are in the commit; scrub any token-like values
   from receipts; confirm `.dockerignore`/merge-hygiene exclusions still hold.
3. Commit the probe/metrics/dashboard/task files only; record the CLOSED_GO
   report (independent arbiter on committed bytes) and journal lifecycle events;
   append S18 lessons to `docs/newsos-master-memory.md`.

## Success Criteria
- [ ] Independent arbiter GO on committed bytes; CLOSED_GO record + journal
      appended.
- [ ] `legacy_writer: disabled`, `phase_21: blocked` preserved; S16/S17 chains
      intact; S12 cutover gates G2/G4 now have real armed probes to run on.
- [ ] No release scope, no Phase 21 authority exercised; Finalize still gated
      by the controller-failover state machine.
- [ ] Metrics store, probe task, and backups live only on the local host; nothing
      machine-local entered the product branch.

## Risk Assessment
N/A — proven S10-S16 pattern. One note: do not let the arbiter receipt claim
"probes running" from a stale task — the arbiter must check LastRunTime and a
fresh sample on the committed bytes, not the probe author's transcript. And do
not scheme-jump into cutover; the observability harness arms the S12 gate, it
does not open it.