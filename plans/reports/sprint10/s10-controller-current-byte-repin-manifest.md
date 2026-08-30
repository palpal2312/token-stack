# S10 controller current-byte re-pin manifest

## Scope and verdict

This controller-owned manifest resolves risk R9 only. It re-pins the physical
bytes of the Phase 2--4 receipt inputs after their integrated Windows checkout.
It does not alter product behavior, test modules, release/cutover authority,
the legacy writer, or the Phase 21 block. Its verdict is **PASS for re-pin
integrity**, not S10 GO/NO-GO.

## Provenance and discrepancy

Each producer receipt retains its original producer-time SHA-256 values as
historical provenance. The receipt verifier hashes physical checkout bytes;
all seven current files contain CRLF line endings in this clean Windows
worktree, whereas the producer values were captured before integration from a
different checkout representation. The original values are therefore not
current-byte verifier inputs. The amended receipts contain controller current
pins below, without deleting the historical values.

| Receipt | Original pin status | Current-byte disposition |
|---|---|---|
| Phase 2 registry | 2 producer pins retained | 2 controller re-pins verified |
| Phase 3 replay/calibration | 2 producer pins retained | 2 controller re-pins verified |
| Phase 4 controlled delivery/recovery | 3 producer pins retained | 3 controller re-pins verified |

## Current-byte pins

e1c0e752f50a6ff4d0740dc3d28b22af30dade5d6151ef7a1f58cd855b440460 plans/reports/sprint10/s10-phase2-registry-receipt.md
93000baa26cfeae8f2323517de43d32abae0ef991b8641cdc30a02ebe8d91771 plans/reports/sprint10/s10-phase3-replay-calibration-receipt.md
1020e0ae77cb91f46ebd2103e05db1f1d7fb4971d8180a2e95bc2cc6951e617a plans/reports/sprint10/s10-phase4-controlled-delivery-recovery-receipt.md
4bc71aa3b79bfdb064efed195dd970782b48dc2f1e832653858a339f85e39d17 src/lib/llmops/s10-registry.ts
4ddaccdd830a848436bc4f601ef0ac34dc65080fa7b0700ec6a70c0abbf5cb7e qa/tests/s10-registry.test.ts
14768b5c685b22eb95edbe27d72f67e1c09a05e07e636d4034dded9ccda1245e src/lib/llmops/s10-replay-calibration.ts
b8f010d3a4f2487f50ea623e1221b15fcd895431a8604168b53b287581129724 qa/tests/s10-phase3-replay-calibration.test.ts
f0a8d5e104c189a2193259a583be1e33ecf21f7e6f5d6e499a6a527b85f75ed9 src/lib/llmops/s10-phase4-canary-recovery.ts
5134035a133a59d7f34f81e5335b1029ef4e19ae5174cfa73ec6bcca4f3490c3 qa/fixtures/sprint10/s10-phase4-simulated-canary-v1.json
f8e55048bdfc3d959fe225f059544a23cce0b056e7a266625d67388b849c71cf qa/tests/s10-phase4-canary-recovery.test.ts

## Verification

Run the controller verifier with `ProjectRoot` set to the clean integrated
worktree against the three amended receipts and this manifest. All four must
return PASS. Focused Phase 2, 3, and 4 suites must also pass from the same
worktree before independent arbitration.

## Boundaries

- This record does not replace the independent arbiter verdict required to
  close Sprint 10.
- The legacy writer remains disabled and Phase 21 remains blocked.
- The original producer-time hashes remain visible but are not used as current
  physical-byte verifier pins.

JOB_DONE: S10 controller current-byte re-pin manifest completed; Phase 2--4 receipt pins are reconciled for current-byte verification.
