# S10 Phase 5 unresolved-risk ledger

## Status

This ledger is redacted and non-authoritative. It is intentionally a risk
inventory, not a GO/NO-GO verdict. It applies to current master `1eed104`
(2026-08-31), the byte set reviewed by the final independent arbiter.

| ID | Risk / missing proof | Status | Safe disposition / arbiter check |
|---|---|---|---|
| R1 | Registry persistence adapter is local-only; durable backing-store recovery is not proved. | Open | Treat the registry as an evidence contract only; do not claim durable recovery. |
| R2 | Replay cohort is frozen/redacted and sparse; calibration is low-confidence/OOD-aware, not a production forecast. | Open, bounded | Retain advisory/no-op behavior for sparse, private, or unavailable inputs. |
| R3 | Canary, monitoring, rollback, and supersession are deterministic simulations. | Open, bounded | No release/promotion/cutover claim; independent arbiter must preserve this distinction. |
| R4 | Daemon, restore, outbox, lease, backend, and snapshot drills were simulated classifications; a loopback-only live runtime drill now adds measured bounded `sloMs`/`rpoMs`/`rtoMs` and restart/fencing/outbox/lease/rollback evidence at `a29362e`. | Open, bounded | Still no production daemon or network claim; the live-runtime arbiter NO_GO'd closure for the reconciliation/chain gap, not the loopback evidence itself. |
| R5 | Orca contains historical S10 tasks still marked `ready` although their corresponding evidence is present. | Open | Controller must settle/supersede stale task metadata before any generic run-level Finalize/CloseGate assertion. |
| R6 | Independent arbitration status. | Closed at `1eed104` | Final independent arbiter `s10-close-nogo-independent-arbiter-verdict.md` accepted the current-byte evidence and the 33/33 focused suite, could not settle the four historical task records (owner-held note channel, C10 §4), and returned **NO_GO — Sprint 10 closes as recorded**. |
| R7 | Legacy writer / Phase 21 controls are policy assertions in evidence, not mutated by this phase. | Protected control | Arbiter/controller must confirm they remain `disabled` / `blocked`; no worker may change them. |
| R8 | `pnpm-lock.yaml` is unrelated and untracked in this worktree. | Excluded | Do not stage, hash, promote, or use it as S10 evidence. |
| R9 | Phase 2--4 receipts contain producer-time pins that do not match the current integrated artifact bytes. | Open / fail-closed | Re-pin receipts (or add a controller-owned current-byte receipt) after integration; do not treat the passing close-packet summary pin as a substitute for their internal verifier failures. |

## Machine-readable current-byte pins

```text
72d07cd336d9829302179f7fbaaac276d57be79360531eb94a1ad24b4e0cc0d2 plans/reports/sprint10/s10-phase5-current-byte-close-packet.md
e86e08386b7cd79330eb31df6a9286bd4de32f3e75f5beb82d9cbf6b58a22a48 plans/reports/sprint10/s10-final-independent-arbiter-verdict.md
a07731ec7a6deab23b0db0201f4f8bf144b33dd191b1d28e328d2bac66d9f223 plans/reports/sprint10/s10-live-runtime-independent-arbiter-verdict.md
fed8124221355db99c3b9e79b6529d2bf5edb7753c14c577b38b3fba05da9d7f plans/reports/sprint10/s10-close-nogo-independent-arbiter-verdict.md
```

## Close conditions

The only close condition this ledger recognizes is an independently authored
and current-byte-verified S10 arbiter verdict. If any pin, focused suite,
controller reconciliation, or protected control fails, retain NO_GO/incomplete
state and do not substitute simulated evidence for live claims.

JOB_DONE: S10 Phase 5 unresolved-risk ledger finalized at 1eed104; final independent arbiter returned NO_GO (Sprint 10 closes as recorded); unresolved items remain explicit.
