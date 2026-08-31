# S04-L1-003 Receipt — typed observation/reconcile contract checkpoint

Date: 2026-08-25. Lane: 1 sole Cursor fallback.
Task/dispatch context (settled prior): `task_d4492afc01ee` / `ctx_f411803d4cce`.
User-owned continuation after settled dispatch — no second lifecycle send;
no `src/` or `docs/` edits; no `dcap_*` in evidence.

## ACTIVE / NEXT / FALLBACK

| Queue | Item |
|---|---|
| **ACTIVE** | S04-L1-003 typed Observation/Classify contract + migration byte-identity (this receipt) |
| **NEXT** | Idle pending coordinator; optional store-side reconnect path when Classify returns `reconnecting` |
| **FALLBACK** | Expand bearer/hash fuzz cases in `contract_test.go` (no Phase 21) |

## Scope correction honored

- Owned only: `go/internal/{orca,reconcile,adapter}`, `go/migrations`
- Did not read or edit `src/` or `docs/`

## Concrete Go artifact (this checkpoint)

| File | Role |
|---|---|
| `go/internal/reconcile/contract.go` | `ValidateObservation`, `Classify`, Decision/Phase contract v1; bearer refuse; hex hash only |
| `go/internal/reconcile/contract_test.go` | Focused contract unit tests |
| `go/internal/orca/schema_test.go` | `000004` migration body == embedded `schemaSQL` |
| `go/internal/reconcile/reconcile.go` | `Reattach` now fail-closed via `ValidateObservation` |

Prior surface retained: adapter negotiation, orca SQLite ID/cursor/pins,
duplicate-Dispatch guard, reattach/quarantine, slots parse/project.

## Checks

```text
rtk go test ./internal/adapter/ ./internal/orca/ ./internal/reconcile/ -count=1 -timeout 120s
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

No commits. Phase 21 not started.

JOB_DONE: S04-L1-003
JOB_DONE: S04-L1
