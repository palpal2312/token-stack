# Phase 12 owner-execution handoff (2026-09-01)

## Status
Phase 12 is READY for owner execution; this controlled checkout is NOT the
cutover host (gate entry condition 1) and NOTHING was flipped:
`legacy_writer: disabled`, `phase_21: blocked` preserved; no canary, no flag
flip, no retire ran here.

## Prepared (proof in repo)
ops-prep (provisioning+budget) · runbook · legacy-surface inventory pins ·
budget approved · failover drill GO 15/15 · host probe executed (9/14 PASS on
the dev box) · controller-failover toolkit restored.

## Owner execution sequence (on the LIVE staging host)
1. Run onboard `plans/260831-0206-s12-phase12-cutover-pack/onboarding-host.ps1`
   on the staging host (fix FAILs per its checklist: env names, NEWSOS dir,
   clone pinned clean).
2. Provision per ops-prep 1a-1g (backup second volume, SLO probes ARMED,
   owner-only flip access), reinstall+enable watchdog.
3. FREEZE: clone the pinned release bytes; record pre-cutover backup hashes.
4. Run runbook: live canary (real SLO/RPO/RTO) → atomic flip (owner-only,
   single command) → write-verification (new adapter canonical) → retire legacy
   (inert, not delete) → post window.
5. Evidence chain: receipts, rollback drill, security review.
6. Pre-cutover arbiter READY → Phase 12 arbiter GO → `CLOSED_GO` record →
   controller Finalize (gated).

## Guard
Any gate failure → executed rollback branch → NO_GO; legacy stays/reverts to
disabled. No agent, script, or CI flips autonomously.

JOB_DONE: Phase 12 owner-execution sequence handed off; cutover executes ONLY
on the owner-provisioned live host.
