# Sprint 02 orchestration retrospective

Period: 2026-08-25. Scope: three Orca producer lanes, controller promotion, independent closure, and controller-continuity hardening.

## Outcome

- Sprint verdict: **CLOSED — GO**.
- Accepted delivery jobs: 32/32 across three lanes (Lane 1: 7, Lane 2: 15, Lane 3: 10).
- Promoted source/module artifacts: 23/23 hash matches.
- Verification: 63 focused tests; 630/630 10x soak executions; vet/build clean; master gate 32 PASS, one pre-registered WARN, zero FAIL; independent Pi verdict GO.
- Phase 20 remains open; Phase 21 remains blocked.

## Objective activity data

| Metric | Observed value | Evidence/limitation |
|---|---:|---|
| Master elapsed time at retrospective checkpoint | 15,482 seconds (4h 18m) | Codex goal counter |
| Master token use at checkpoint | 1,029,111 | Codex goal counter; agent/provider totals unavailable |
| Commits during sprint | 0 | `git log` for 2026-08-25; no-commit constraint was explicit |
| Git LOC/churn/test ratio | N/A | Work remained uncommitted, so git-history metrics would be false precision |
| Promoted lane reports | 37 | Master `plans/reports/sprint02-lane{1,2,3}` at closure checkpoint |
| Final independent arbiters | 1 | Pi promoted-master closure report |
| Provider/context incidents | 4 classes | Primary quota exhaustion, fallback high load, 100% context replacement, prompt-hook ambiguity |

Plan completion formula: `32 accepted closure jobs / 32 recorded closure jobs = 100%`. This measures the reconciled Sprint 02 backlog, not all historical task IDs or post-sprint continuity hardening.

## What worked

1. Worktree ownership prevented producer collisions: Lane 1 owned core/product, Lane 2 community/handoff, Lane 3 gate/review.
2. Machine receipts (`JOB_DONE`) and frozen hashes made controller promotion mechanical instead of interpretive.
3. Lane 3 started verification before producers finished and found real contract/state-machine defects early.
4. Provider fallback preserved the same Task ID, worktree and acceptance criteria; Lane 1 recovered from quota exhaustion without restarting the feature.
5. Independent Pi re-gating after promotion caught operational residue and proved no source/DB-byte drift.
6. The product gate used real materialized SQLite DBs and adversarial scenarios, not mock-only evidence.

## What consumed excessive master tokens

1. The controller repeatedly read full terminal screens while state was unchanged. Most polls needed only terminal metadata, cursor deltas and receipt markers.
2. Short Lane 2 jobs completed faster than the 15-minute detector, forcing manual redispatch. `ACTIVE` was not always accompanied by a sufficiently long `NEXT` chain.
3. Progress and evidence were duplicated across terminal output, many reports, manifests and controller summaries.
4. Ambiguous prompt-hook responses caused extra inspection cycles. The eventual rule—inspect screen/file activity before retry—arrived after repeated cost.
5. Context replacement was initiated at 100% instead of being prepared around 80–90%.
6. Master performed frequent narrative reasoning during healthy periods. A local observer could have emitted the compact three-lane counter without an LLM call.
7. Final closure expanded into controller-failover design. Valuable, but it should be a separately prepared fallback package before the next sprint begins.

## Low-token continuous-observation design

Use two loops:

### Loop 1 — token-free observer (every 5 minutes)

- PowerShell/Orca reads exact terminal handles, connection/writable state, `tui-idle`, `lastOutputAt`, queue state and bounded output cursor.
- It updates one local ledger and prints only: `Lane 1: done/total | Lane 2: done/total | Lane 3: done/total || Total: done/total`.
- No model prompt is sent when state is unchanged and all lanes are healthy.
- It recognizes deterministic events: `JOB_DONE`, provider/auth/quota failure, disconnected terminal, stale ACTIVE, context-risk marker, gate GO/NO-GO and queue exhaustion.

### Loop 2 — event-driven master

Invoke a controller model only for a state transition or anomaly:

- completed job needs receipt/evidence acceptance and prepared NEXT dispatch;
- idle lane still has backlog;
- provider fallback or context replacement is needed;
- blocker requires scope/dependency judgment;
- queue is exhausted and `$ak:plan` must refill useful work;
- promotion, integration or independent gate requires judgment.

The master receives a compact delta packet: prior/current state, last receipt, changed artifact hashes, failing rule code, queue head and exact terminal handle. Full reports are loaded only at promotion or gate review.

## Queue shape for the next sprint

- Preload each worker with `ACTIVE + NEXT + FALLBACK`; NEXT should normally contain 30–90 minutes of bounded, self-advancing work rather than a seconds-long report-only task.
- Let agents self-transition on verified `JOB_DONE`; the 15-minute cron remains a safety net, not the normal dispatcher.
- Prepare provider fallback and fresh-context terminal before 80% context. Fence the old writer before replacement.
- When one lane exhausts its scope, move it to cross-lane verification/integration rather than generating artificial work.
- Run one independent final arbiter after promotion; do not repeatedly re-summarize already frozen evidence.

## Actions adopted

1. Added token-free controller lease/failover watcher and five-minute Scheduled Task.
2. Added exact owner/generation claim rules, persisted-before-send state, and isolated 11-check failover drill.
3. Added the low-token observation contract and memory-update protocol to the orchestration runbook.
4. Added project skill `/newos-master` to resume from the latest lease/handoff and continuously preserve verified lessons.

## Remaining non-blocking debt

- Gate read-only inspection can create empty WAL/SHM sidecars beside checkpointed DB snapshots. DB bytes remain unchanged; copy-first static inspection is the preferred later hygiene fix.
- Timestamp SQL-CHECK language should be reconciled with frozen AO-14 even though runtime/DB validation is present.
- Runtime terminal handles must be refreshed after Orca terminal replacement or machine restart.
