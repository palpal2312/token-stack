# S04-L1-001 Receipt — typed Orca adapter / reconcile / cursor persistence

Date: 2026-08-25. Lane: 1. Sprint: `orchestrate-260825-sprint04-orca-reconcile`.
Task: `task_d4492afc01ee`. Active dispatch: `ctx_f411803d4cce`
(prior fenced: `ctx_eb83384abbe3` / `agent_prompt_stalled`; preamble capability
revoked — heartbeats/completions use active dispatch IDs only; no `dcap_*` in
this evidence tree).

## ACTIVE / NEXT / FALLBACK

| Queue | Item |
|---|---|
| **ACTIVE** | S04-L1-001 typed adapter + SQLite ID/cursor + reconcile/reattach (this receipt) |
| **NEXT** | S04-L1-002 wire `orca.RuntimeSlots` JSON into a read-only daemon projection helper + freeze hashes for Lane 2/3 RC-12 re-point (`orcaslots` → `orca`) |
| **FALLBACK** | Expand `reconcile` unit coverage for observe-only reconnecting phase + cursor regression edge cases (no Phase 21) |

## Route

AgentKit dynamic → implement (Ponytail minimal) → bounded `go test` verify.
No commits. Master coordination-only. Phase 21 not started.

## Delivered

| Package | Role |
|---|---|
| `go/internal/adapter` | Typed capability negotiation (contract v1, required feature set, stable SHA-256 hash) |
| `go/internal/orca` | SQLite `orca-runtime.db`: dispatches, terminal cursors, capability pins; slot DTO types; unique one-active-dispatch-per-task index |
| `go/internal/reconcile` | Persist-first reattach, stale/mismatch quarantine, revoked-capability quarantine, duplicate-Dispatch refuse |
| `go/migrations/000004_orca_dispatch_cursors.sql` | Forward mirror of embedded schema v1 |

## Checks

```text
rtk go test ./internal/adapter/ ./internal/orca/ ./internal/reconcile/ -count=1 -timeout 60s
→ Go test: 15 passed in 3 packages (exit 0)
```

## Digests (SHA-256)

```text
b6cb7f0299b78278d12b11def35a2d13c1a949fa2d3f230bbbb8322b0719f3af  go/internal/adapter/negotiate.go
cb8472edefdb81b18a1a58bcfa6f37aa4d9fcecd66d5ae30d226df93e5e5ce1b  go/internal/adapter/negotiate_test.go
85ee10164b6de82e840920d562c0341608812f93e327fd3ba70c157dbf2bb64a  go/internal/orca/schema.go
fd7af19c0456eea58f74f08d588849cc54c2d9808a8e03a1b115647b1217dfec  go/internal/orca/store.go
0dd4af82c5de44b109a52cbcc89e6ffa57572800740459ab882b70a9b1111242  go/internal/orca/store_test.go
fc5f06f72e243cab36d4e70983f3b863fae0c64f4d6adad8bf116d4a67355765  go/internal/reconcile/reconcile.go
918e474e8ea34f315385a3969f578ccaf36a58b2fca801a52a882d270c8835da  go/internal/reconcile/reconcile_test.go
8476448cc8b4425a6e9339d3b1e5e63bf96d1ccc8f2d14bc5d69081d89ef252f  go/migrations/000004_orca_dispatch_cursors.sql
```

## Cross-lane notes

- Lane 3 RC-12 / fixtures that name `go/internal/orcaslots` should re-point to
  `go/internal/orca` (exact Lane 1 ownership). Slot DTO version remains `1`.
- Lane 2 `OrcaReconcileProjectionDTO` phases match `reconcile.Phase`
  (`steady|reconnecting|reattaching|quarantined|observe_only`).

## Out of scope

Daemon HTTP join, Phase 21 promotion, commits, master coding, Lane 2/3 writes.

JOB_DONE: S04-L1-001
JOB_DONE: S04-L1
