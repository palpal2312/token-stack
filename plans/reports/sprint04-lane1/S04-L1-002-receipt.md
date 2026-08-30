# S04-L1-002 Receipt — RuntimeSlots projection + RC-12 unblock

Date: 2026-08-25. Lane: 1 sole writer.
Task: `task_6100657c5ad1`. Dispatch: `ctx_c9424b75a510`.
Sprint: `orchestrate-260825-sprint04-orca-reconcile`.
No commits. Phase 21 not started. No Lane 2/3 files touched.
No capability bearers in this evidence tree.

## ACTIVE / NEXT / FALLBACK

| Queue | Item |
|---|---|
| **ACTIVE** | S04-L1-002 RuntimeSlots helper + orcaslots→orca naming (this receipt) |
| **NEXT** | Lane 3 RC-12 run against `agentic-os/internal/orca` |
| **FALLBACK** | none in Lane 1 scope |

## RC-12 resolution (Lane 1 side)

- Canonical package: `go/internal/orca` (`CanonicalPackagePath`).
- Legacy name `orcaslots` documented as obsolete (`LegacyPackagePathAlias`); Lane 1 does not publish `go/internal/orcaslots`.
- RuntimeSlots projection helper: `ParseRuntimeSlots` / `EncodeRuntimeSlots` / `FixtureRuntimeSlots` in `orca`; observe-only join `reconcile.ProjectSlots`.
- ADR: `plans/reports/orchestrate-260825-sprint04-orca-reconcile/lane1/s04-l1-002-adr-checkpoint.md`

## Delta files

| File | Role |
|---|---|
| `go/internal/orca/naming.go` | Canonical vs legacy package path constants |
| `go/internal/orca/naming_test.go` | Naming + RuntimeSlots round-trip tests |

Prior ADP-05 surface retained: adapter negotiation, SQLite ID/cursor store,
reconcile reattach/quarantine/duplicate-Dispatch guard, migration `000004`.

## Checks

```text
rtk go test ./internal/orca/ ./internal/reconcile/ ./internal/adapter/ -count=1 -timeout 90s
→ Go test: 35 passed in 3 packages (exit 0)
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
084db13eb12dab31ac451e0cdddc1b645a8d020725b69c35c6259de9f4cd261f  go/internal/orca/naming.go
7da44c974f5618e97857bf577de8d3c1de6551b8d629cd6e4c8c0715347a217b  go/internal/orca/naming_test.go
1f7082f653a45c10896d268412695c63dc3cb058013575ff0239b54bd7555c58  go/internal/reconcile/reconcile.go
14e712a936bae79fb21aa725c43a948218ba2c2c97d6dcb72d61e965e743b28b  go/internal/reconcile/reconcile_test.go
ba0a66ed824e93245c55682c4e1497e5c9f74bb532bb4465ec446063da7f809d  go/internal/reconcile/contract.go
7756ffabbed04e78878ce745f2fbb348ffa0be158abec9095f2758f60587fc69  go/internal/reconcile/contract_test.go
feec58b82c9b1124a73334b4d97d35a0805abc4c12f49e2b44118d668390091c  go/internal/reconcile/slots_project.go
66834ce91cee22c2264b21d826f5f0cb5b08ba5cb0343ac9f04feaf53ef52c4b  go/internal/reconcile/slots_project_test.go
21464a3858fb2a8160d8b1752e06d987c5827aa5c32d1b1d3b3833d32fdddf5b  go/internal/reconcile/observation_contract.go
09f214ee0e21f56e87d5e650aacbb2ae33d7da0a7b110df9983b099cc403ef11  go/internal/reconcile/observation_contract_test.go
8476448cc8b4425a6e9339d3b1e5e63bf96d1ccc8f2d14bc5d69081d89ef252f  go/migrations/000004_orca_dispatch_cursors.sql
```

JOB_DONE: S04-L1-002

## Completion channel

Dispatch `ctx_c9424b75a510` capability was already revoked (`agent_prompt_stalled`)
before heartbeat/`worker_done` could land. Evidence is this receipt + ADR + Go
artifacts on disk for coordinator observe-by-file.
