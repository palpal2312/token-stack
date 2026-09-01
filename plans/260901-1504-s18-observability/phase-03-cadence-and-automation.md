---
phase: 3
title: "Cadence/automation — scheduled probe + backup cadence hook"
status: pending
priority: P1
effort: ""
dependencies: [2]
---

# Phase 3: Cadence/automation — scheduled probe + backup cadence hook

## Overview
Turn the probe harness into a running service and the backup rules into an
enforced cadence. One Windows scheduled task installs and keeps the probe Watch
loop alive (mirroring the existing `install-controller-failover-task.ps1`
pattern), with a documented cadence section in the ops run/docs so the night /
pre-flip / post-flip backup schedule and its `sha256sum -c` verification are
enforced and reviewed rather than remembered.

## Requirements
- Functional:
  - `scripts/install-s18-probe-task.ps1` registers
    `NEWSOS S18 SLO Probes` as a scheduled task on the local host: start every
    minute, run `s18-slo-probes.ps1 -Watch` with the same run-as/user learnings
    the failover installer already handles; the task is the watchdog for the
    Watch loop (OM-02: local polling, no model tokens).
  - The install script is idempotent (re-register overwrites) and verifies the
    task starts executing (a `-SelfCheck` fires a synthetic failing healthz to
    prove an alert actually pages/records before it is ever needed — G4 armed).
  - Backup cadence enforcement: an extension of the probe or a companion
    `scripts/s18-backup-cadence.ps1` runs on the cadence (S16 lesson: verify
    every cycle with `sha256sum -c` from the manifest's own root; keep cycles
    outside git) and records a receipt line — nightly, and pre/post-flip hooks
    noted for the live cutover window per the S12 ops-prep §1e schedule.
  - The run/docs get a short cadence section: when the probe task runs, what
    each alert means, the backup schedule + verification command, and where
    receipts live.
- Non-functional:
  - No broad-write run-as: the probe/backup tasks run with the least privilege
    that can reach loopback and the store dir; nothing can flip
    `legacy_writer` (ops-prep §1f — owner-only, no automation).
  - Rotation runs as part of the cadence job, not ad hoc.
  - IDempotent, no secrets in task arguments (env var names only), and the
    install script logged for recreate-on-host.

## Architecture
- One scheduled task driving Phase 1's `-Watch` loop; the loop itself owns the
  30s polling cadence. The task's 1-minute start just guarantees the loop gets
  restarted if it ever dies.
- Backup cadence runs from the same scheduled-task family (a second trigger on
  the same task, or a sibling task) executing `s18-backup-cadence.ps1`, which
  mirrors the DB files to the second volume and emits a
  `{ts, backuptype, sha256verified, ok}` receipt line into the metrics store.
- Cadence documentation lands in the ops-prep pack (a short "cadence" addendum)
  and the runbook step list, so operators see the cadence inline with the
  cutover timeline rather than hunting for it.

## Related Code Files
- Add: `scripts/install-s18-probe-task.ps1`, `scripts/s18-backup-cadence.ps1`.
- Modify: `scripts/s18-slo-probes.ps1` (rotation hook on the cadence job,
  `-SelfCheck` path for the synthetic alert).
- Read: `scripts/install-controller-failover-task.ps1` (task-registration
  pattern to mirror), `scripts/controller-failover.ps1` (loop/watchdog pattern),
  `plans/260831-0206-s12-phase12-cutover-pack/ops-prep.md` §1e (backup schedule:
  nightly + pre-flip + post-flip, retention 7 days, restore drill receipt),
  `plans/260831-0206-s12-phase12-cutover-pack/runbook.md` (where the cadence
  addendum + step list edits go).

## Implementation Steps
1. Add `install-s18-probe-task.ps1` registering the probe task; run it and
   confirm the task exists, executes, and the probe Watch loop restarts on a
   forced stop.
2. Run `-SelfCheck` once: injected synthetic failing healthz must produce an
   `alert:availability` receipt the dashboard would show (G4: armed before
   canary, not discovered during it).
3. Add `s18-backup-cadence.ps1` with the nightly + pre/post-flip hooks and
   `sha256sum -c` verification against the backup manifest root; emit a receipt
   line per cycle; run one real cycle and confirm the receipt.
4. Wire monthly rotation into the cadence job; confirm the JSONL rotation moves
   the current file with no dropped lines.
5. Add the cadence section to the S12 ops-prep pack (§1d/§1e addendum, runbook
   step list) and record the install + a sample receipt for the report.

## Success Criteria
- [x] `install-s18-probe-task.ps1` is idempotent, registers the probe task, and (_evidence: see CLOSED_GO record)      the task self-heals the Watch loop after a forced stop.
- [x] `-SelfCheck` produces a visible `alert:availability` receipt before any (_evidence: see CLOSED_GO record)      live deployment (armed, not discovered).
- [ ] `s18-backup-cadence.ps1` runs a real verified cycle: backup mirrored to  (OPEN: see checklist audit ledger)
    (OPEN: see checklist audit ledger)
      the second volume, `sha256sum -c` pass, receipt line written.
- [ ] Rotation moves monthly JSONL with no dropped appendix lines.  (OPEN: see checklist audit ledger)
    (OPEN: see checklist audit ledger)
- [x] Ops-prep/runbook carry the cadence section; no automation anywhere can (_evidence: see CLOSED_GO record)      flip `legacy_writer`.

## Risk Assessment
Assumption: the scheduled-task install pattern from the failover installer maps
cleanly (same host, same registration API).
Signal: the probe task never fires (missed trigger/permissions) → response:
`install-s18-probe-task.ps1` `-SelfCheck` surfaces the miss at install time, and
the docs say any live run starts by confirming the task LastRunTime is fresh.
Signal: backup verification fails a cycle → response: the cadence script fails
loudly and leaves the receipt line with `ok:false`; per ops-prep §1e a failed
verification is a hold condition before any flip the next day.
Signal: greedy backup cadence overlaps the probe loop on one box → response:
separate trigger times and a write-lock on the receipt file; both tasks are
local and light — overlap is a non-issue beyond the lock.