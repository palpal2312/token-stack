# S04-L1 Lane1 contract checkpoint

Date: 2026-08-25. Lane: 1. Sprint: `orchestrate-260825-sprint04-orca-reconcile`.
Writer: Cursor fallback (sole Lane 1). No commits. Phase 21 not started.
Ownership only: `go/internal/orca`, `go/internal/reconcile`, `go/internal/adapter`, `go/migrations`.

## ACTIVE / NEXT / FALLBACK

| Queue | Item |
|---|---|
| **ACTIVE** | Typed observation/reconcile contract + SQLite ID/cursor + adapter negotiation (landed) |
| **NEXT** | Coordinator consume; Lane 3 RC-12 re-point package path to `go/internal/orca` |
| **FALLBACK** | Additional reconnect-path store wiring if Classify `reconnecting` needs durable I/O |

## Contract (typed)

### adapter (`go/internal/adapter`)
- Contract version `1`
- Required features: `slots.read`, `reconcile.reattach`, `cursor.persist`, `dispatch.duplicate_guard`
- `Negotiate` fail-closed on version/feature mismatch; stable SHA-256 capability hash (no bearer strings)

### orca (`go/internal/orca` + `go/migrations/000004_orca_dispatch_cursors.sql`)
- SQLite `orca-runtime.db`: dispatches, terminal cursors, capability pins
- Unique partial index: one active (`dispatched`/`running`) Dispatch per Task
- Monotonic cursor advance; terminal status immutable; quarantine frees task for new Dispatch
- Fail-closed RuntimeSlots parse/encode (dto_version=1)

### reconcile (`go/internal/reconcile`)
- `Observation` / `Projection` / `Phase` / `Decision`
- `ValidateObservation` — required IDs for mutating paths; hex hash only; bearer refused
- `Classify` — observe_only | claim | reattach | reconnecting | quarantine (pure, pre-I/O)
- `Engine.Reattach` — persist-first claim/reattach; stale/mismatch + revoked capability quarantine; duplicate-Dispatch refuse
- `ProjectSlots` — observe-only slots+reconcile join encode

## Checks

```text
rtk go test ./internal/adapter/ ./internal/orca/ ./internal/reconcile/ -count=1 -timeout 90s
→ Go test: 31 passed in 3 packages (exit 0)
```

## Digests (SHA-256)

```text
b6cb7f0299b78278d12b11def35a2d13c1a949fa2d3f230bbbb8322b0719f3af  go/internal/adapter/negotiate.go
cb8472edefdb81b18a1a58bcfa6f37aa4d9fcecd66d5ae30d226df93e5e5ce1b  go/internal/adapter/negotiate_test.go
85ee10164b6de82e840920d562c0341608812f93e327fd3ba70c157dbf2bb64a  go/internal/orca/schema.go
fcb65d4d7d4ce976cc49ccc2d938347e78783f9ae14320e216d5c4f5e2391558  go/internal/orca/schema_test.go
fd7af19c0456eea58f74f08d588849cc54c2d9808a8e03a1b115647b1217dfec  go/internal/orca/store.go
0dd4af82c5de44b109a52cbcc89e6ffa57572800740459ab882b70a9b1111242  go/internal/orca/store_test.go
0de6edced8ec152605adf2f9a2c01c91def0eb7cd835439cda48c43f7fe1eecc  go/internal/orca/slots.go
abad921fc60d3a0557565a650e02d82936209a195338b5ba0f5029101df781f3  go/internal/orca/slots_test.go
1f7082f653a45c10896d268412695c63dc3cb058013575ff0239b54bd7555c58  go/internal/reconcile/reconcile.go
14e712a936bae79fb21aa725c43a948218ba2c2c97d6dcb72d61e965e743b28b  go/internal/reconcile/reconcile_test.go
ba0a66ed824e93245c55682c4e1497e5c9f74bb532bb4465ec446063da7f809d  go/internal/reconcile/contract.go
7756ffabbed04e78878ce745f2fbb348ffa0be158abec9095f2758f60587fc69  go/internal/reconcile/contract_test.go
feec58b82c9b1124a73334b4d97d35a0805abc4c12f49e2b44118d668390091c  go/internal/reconcile/slots_project.go
66834ce91cee22c2264b21d826f5f0cb5b08ba5cb0343ac9f04feaf53ef52c4b  go/internal/reconcile/slots_project_test.go
8476448cc8b4425a6e9339d3b1e5e63bf96d1ccc8f2d14bc5d69081d89ef252f  go/migrations/000004_orca_dispatch_cursors.sql
```

## Evidence links

- Prior receipts: `plans/reports/sprint04-lane1/S04-L1-001-receipt.md` … `S04-L1-003-receipt.md`
- This checkpoint is the coordinator-facing Lane1 freeze under the sprint04 run tree.

JOB_DONE: S04-L1-CONTRACT-CHECKPOINT
JOB_DONE: S04-L1
