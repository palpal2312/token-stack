# S04-L3-004 — Runbook update + Lane 3 handoff

Date: 2026-08-25. Lane: 3. Dispatch: task_83aebde0f562 / ctx_6a167ac701e6.

## Runbook changes (docs/orchestration-runbook.md)

Added section **"Orca reconcile recovery and slot wire hygiene (Sprint 04)"**
with five evergreen rules, all backed by Lane 3 verified evidence (rules here,
detail in reports — per the runbook's own evidence-hygiene contract):

1. Reconcile never destroys on uncertainty (orphans-only cleanup; probe error
   → unknown; failed cleanup → retained; attempt self-clean).
2. Reattach recovery is idempotent — second pass is a pure no-op (RC-07).
3. Reconcile passes are not single-flighted (F-01); `RunLoop` is the only
   supported driver; `-race` claims require a preflighted detector.
4. Slot wire data fail-closed at the parse boundary (safe-field contract).
5. An invalid worker command is a dispatch failure — fence primary, one
   fallback dispatch, unchanged ownership (this sprint's Lane 3 incident).

## Lane 3 handoff state

| Item | State |
|---|---|
| S04-L3-001 recovery matrix | DONE — 11/11 runnable cells PASS; RC-12 pending-lane1 |
| S04-L3-002 boundary audit | DONE — 16/16 PASS, 171 files scanned, zero findings |
| S04-L3-003 measurements | DONE — reconcile pass ≈0.79 ms @1k / ≈10.3 ms @10k tracked; audit 1.48 s |
| S04-L3-004 runbook + handoff | DONE — this document |
| Pending-lane1 | RC-12 runtime cell when `go/internal/orcaslots` lands; F-01 single-flight note (doc or pass-lock, Lane 1 decision) |

## Reusable assets (qa/fixtures/sprint04/)

- `recovery-matrix.json` — 12-cell failure-injection matrix with evidence levels
- `reconcile-runner/` — Go module executing RC-01..RC-11 against the real reconciler + bench mode (exit 0 = pass)
- `boundary-audit.py` — 16-check privacy/reconcile boundary audit (exit 0 = clean)

## Verification commands (token-free)

```bash
cd qa/fixtures/sprint04/reconcile-runner && go run . --bench --json <evidence.json>
python qa/fixtures/sprint04/boundary-audit.py --json <evidence.json>
cd go && go test ./internal/builderexec/ -count=1
```

All exit 0 at handoff. No commits made. No Lane 1/Lane 2 source modified
(runners consume their code read-only; go.mod `replace` points at the existing
module, nothing written into `go/`). Phase 21 untouched.

## Next-lane triggers

- Lane 1 lands `go/internal/orcaslots` → execute RC-12 runtime cell; matrix already parameterized.
- Lane 1 decides F-01 (document single-driver vs add pass-level mutex).
- Sprint close → run `boundary-audit.py` as the evidence-hygiene gate (already in runbook).

JOB_DONE: S04-L3-004
