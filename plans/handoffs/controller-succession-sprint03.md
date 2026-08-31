---
run_id: orchestrate-260825-sprint03-chat
status: active
owner: codex-master
---

# Sprint 03 controller succession handoff

Sprint 03 runs Durable SEN Chat and realtime continuity on the promoted SQLite
interfaces. Orca remains execution authority; this controller coordinates
lanes, promotion and evidence only.

## Scope

- Lane 1: SQLite chat sessions, attempts, sequenced events and checkpoints.
- Lane 2: typed SEN API/client/SenView reconnect behavior.
- Lane 3: recovery evidence, privacy/boundary audit, measurements and runbook.
- Phase 20 remains open. Phase 21 remains blocked.

## Succession rules

1. Read `docs/newsos-master-memory.md` and `docs/orchestration-runbook.md`.
2. Never steal a healthy lease. Claim only the exact watchdog-dispatched owner,
   terminal and generation.
3. Keep `ACTIVE + NEXT + FALLBACK` for every lane. Use local five-minute
   observation and invoke model reasoning only for events or anomalies.
4. Master must not code, commit, or silently change product boundaries.
5. On completion, run the independent arbiter, release the lease and update
   the shared Sprint 03 plan/HANDOFF.

## First safe action

Run `/newos-master -Mode Locate` and `/newos-master -Mode Status`, then inspect
the Sprint 03 backlog and current Orca terminal output before claiming or
dispatching anything.
