# ADR: S04-L1 ADP-05 Orca observation / reconcile contract

Status: Accepted (Lane 1 checkpoint)  
Date: 2026-08-25  
Sprint: orchestrate-260825-sprint04-orca-reconcile  
Ownership: `go/internal/orca`, `go/internal/reconcile`, `go/internal/adapter`, `go/migrations` only

## Decision

Lane 1 owns the durable typed contract for Orca Dispatch identity, capability
negotiation (hash-only), terminal output cursors, and reconcile/reattach
classification. SQLite (`orca-runtime.db`) is the sole local authority for
Dispatch/cursor/capability-pin rows. Mutating reattach is persist-first.
Duplicate active Dispatches for one Task fail closed. Stale/mismatch and
revoked-capability observations quarantine. Secrets and raw capability bearers
are never persisted or accepted on the Observation surface.

## Contract summary

| Surface | Package | Rule |
|---|---|---|
| Capability negotiation | `adapter` | Contract v1; required features; stable SHA-256 hash |
| ID / cursor / pins | `orca` + migration `000004` | One active Dispatch per Task; monotonic cursors |
| Observation / Classify / Reattach | `reconcile` | Validate → Classify → persist-first Reattach |
| Phases | `reconcile.Phase` | `steady\|reconnecting\|reattaching\|quarantined\|observe_only` |

## Non-goals

Daemon HTTP join, `src/` UI, `docs/` edits, Phase 21, commits, master coding.

## ACTIVE / NEXT / FALLBACK

| Queue | Item |
|---|---|
| **ACTIVE** | This ADR + typed Go contract/test under ownership |
| **NEXT** | Coordinator freeze consume; cross-lane re-point to `go/internal/orca` |
| **FALLBACK** | Expand reconnect durable I/O if Classify `reconnecting` needs store writes |

## Evidence

- Checkpoint: `plans/reports/orchestrate-260825-sprint04-orca-reconcile/lane1/s04-l1-contract-checkpoint.md`
- This ADR: `plans/reports/orchestrate-260825-sprint04-orca-reconcile/lane1/s04-l1-adr-checkpoint.md`
- Go: `go/internal/{adapter,orca,reconcile}`, `go/migrations/000004_orca_dispatch_cursors.sql`

JOB_DONE: S04-L1-ADR-CHECKPOINT
JOB_DONE: S04-L1
