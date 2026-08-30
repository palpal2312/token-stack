# S10 Phase 5 portable next-controller handoff

## Current state

`master` evidence baseline is `14b3546`. Phase 1--4 receipts and the Phase 5
current-byte close packet exist, but **S10 is not closed**. This handoff grants
no GO/NO-GO, release, cutover, legacy-writer, or Phase 21 authority.

Protected invariants: `legacy_writer: disabled`; `phase_21: blocked`; no
release/cutover; do not modify shared DTO/schema/migrations without the
designated integration owner `palpal2312/admin`.

## Exact next controller sequence

1. Start from a clean master worktree. Do not use the dirty controller
   worktree as evidence; recompute the close-packet pins from Git/current
   bytes.
2. Run the four focused suites:

   ```powershell
   npx --no-install tsx --test qa/tests/s10-registry.test.ts qa/tests/s10-phase3-replay-calibration.test.ts qa/tests/s10-phase4-canary-recovery.test.ts qa/tests/s10-lane-c-recovery-drill.test.ts
   ```

3. Verify the Phase 5 close-packet and receipt manifest with
   `newos-receipt-verify.ps1`, then take a fresh Orca/task/process/control
   reconciliation snapshot.
4. Settle or explicitly supersede historical `ready` S10 task records; do not
   mark evidence complete merely because an old task has a similar name.
5. Create a fresh, independent, read-only S10 arbiter task against the exact
   promoted bytes. The arbiter must decide GO/NO_GO and must not be the packet
   author or integration owner.
6. Only on independently recorded GO may the integration owner write an S10
   `CLOSED_GO` record and consider Finalize. Otherwise retain NO_GO/incomplete
   and preserve all protected controls.

## Fallback

If a receipt hash or focused test fails, a protected control changes, a task
cannot be reconciled, or the arbiter returns NO_GO: stop finalization; record
the exact failing byte/state; keep legacy writer disabled and Phase 21 blocked;
resume from this packet without guessing or replacing missing evidence.

## Redaction review

This handoff contains only refs, paths, bounded status, and commands. It
contains no raw Run Learning record, prompt/transcript, credential, external
URL, or secret.

JOB_DONE: S10 Phase 5 portable next-controller handoff completed; independent arbitration is the next authority gate.
