# ADR / checkpoint — S04-L1-002 RC-12 unblock

Status: Accepted  
Date: 2026-08-25  
Task: `task_6100657c5ad1` / dispatch `ctx_c9424b75a510`  
Ownership: `go/internal/orca`, `go/internal/reconcile`, `go/internal/adapter`, `go/migrations` only

## Decision

Canonical daemon package path is **`go/internal/orca`** (not `orcaslots`).
RuntimeSlots parse/encode and reconcile SlotProjection live under that ownership.
Lane 3 RC-12 (`canonical-slot-reconcile-runtime`, formerly pending-lane1) is
unblocked for re-point to `go/internal/orca` without Lane 1 editing Lane 2/3 files.

## ACTIVE / NEXT / FALLBACK

| Queue | Item |
|---|---|
| **ACTIVE** | S04-L1-002 RuntimeSlots projection + RC-12 naming alignment (this job) |
| **NEXT** | Lane 3 executes RC-12 against `go/internal/orca` |
| **FALLBACK** | None inside Lane 1 scope |

## Non-goals

Lane 2/3 file edits, Phase 21, commits, orchestration introspection in evidence.

JOB_DONE: S04-L1-002-ADR
