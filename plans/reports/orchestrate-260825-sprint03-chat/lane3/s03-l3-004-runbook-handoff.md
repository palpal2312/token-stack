# S03-L3-004 — Runbook update + Lane 3 handoff

Date: 2026-08-25. Lane: 3. Dispatch: task_3107211e719e / ctx_a15fb0a6a122.

## Runbook changes (docs/orchestration-runbook.md)

Added section **"Durable-chat recovery and evidence hygiene (Sprint 03)"** with four evergreen rules, all backed by Lane 3 verified evidence (OM-10 compliant: rules here, detail in reports):

1. Copy-first SQLite inspection mandatory (closes Sprint 02 sidecar debt; FI-07).
2. Four durable-chat recovery invariants to verify before promotion (persist-before-ack + command-id replay; seq dedupe + gap-refetch; lease-generation fencing; single-writer busy-surface).
3. Credential material never crosses into evidence — `msg_*`/`task_*`/`ctx_*` IDs only, never `dcap_*`/tokens (BA-01 incident).
4. Verification runners are token-free, self-checking, compact-counter-emitting.

## Lane 3 handoff state

| Item | State |
|---|---|
| S03-L3-001 recovery matrix | DONE — 7/7 runnable cells PASS (6 fixture + FI-07 live ×2 promoted DBs) |
| S03-L3-002 privacy/boundary audit | DONE — 14/14 PASS after Lane 2 scrubbed BA-01 |
| S03-L3-003 latency/loss/duplicate runner | DONE — 3/3 scenarios PASS vs real Lane 2 fns; latency p50 0.55 ms tail / 10.55 ms cold-50k |
| S03-L3-004 runbook + handoff | DONE — this document |
| Pending-lane1 | FI-04/FI-05 fixture-verified but must re-run on canonical store; FI-10 runtime probe; all fixture cells re-point at real Lane 1 schema when it lands |

## Reusable assets (qa/fixtures/sprint03/)

- `chat-contract.json` — canonical chat contract reconstructed from Lane 2 client + proxy
- `recovery-matrix.json` — 10-cell failure-injection matrix with evidence levels
- `failure-inject.py` — FI-01/02/03/06/08/09 (exit 0 = pass)
- `sqlite-inspect.py` — copy-first inspector (FI-07)
- `boundary-audit.py` — 14-check privacy/boundary audit (exit 0 = clean)
- `event-evidence-runner.ts` — FI-04/05 + latency vs real Lane 2 functions (run: `npx tsx`)

## Verification commands (token-free)

```bash
python qa/fixtures/sprint03/failure-inject.py --json plans/reports/orchestrate-260825-sprint03-chat/lane3/s03-l3-001-failure-inject-evidence.json
python qa/fixtures/sprint03/sqlite-inspect.py go/internal/localdb/community-queue.db
python qa/fixtures/sprint03/sqlite-inspect.py go/internal/localdb/sen-product.db
python qa/fixtures/sprint03/boundary-audit.py --json plans/reports/orchestrate-260825-sprint03-chat/lane3/s03-l3-002-boundary-audit-evidence.json
npx tsx qa/fixtures/sprint03/event-evidence-runner.ts --json plans/reports/orchestrate-260825-sprint03-chat/lane3/s03-l3-003-event-evidence.json
```

All exit 0 at handoff. No commits made. No Lane 1/Lane 2 source modified. `__pycache__` residue under `qa/fixtures/sprint03/` left in place — removal blocked by scout-block hook; harmless, regenerate anytime.

## Next-lane triggers

- Lane 1 lands canonical chat schema → re-point matrix cells (runner accepts DB path), execute FI-10 runtime probe, re-run full suite.
- Sprint close → run `boundary-audit.py` as the evidence-hygiene gate (already in runbook).

JOB_DONE: S03-L3-004
