# S03-L1-002..004 Evidence Report

## Status

DONE. Focused localdb suite: **33 passed in 2 packages, exit 0**. No further process investigation.

## Canonical result

```text
gofmt -l ./internal/localdb/product/ ./internal/localdb/core/
GOFMT_CLEAN

rtk go test -count=1 ./internal/localdb/core/... ./internal/localdb/product/...
Go test: 33 passed in 2 packages
exit 0
```

Observed wall time for the first full focused run was ~7.5 minutes (PID 23228 / terminal `791732`, `elapsed_ms: 452771`). That duration is a **timing concern** (cold compile of `modernc.org/sqlite` + RTK suppressing pass chatter until completion), not a hung test or product failure. Subsequent bounded reruns completed in seconds (`core` ~2.5s, `product` ~6–7s with `-timeout 90s`).

## S03-L1-002 — Durable session/turn/attempt schema

- Migration v3 in `go/internal/localdb/product/schema.go`; SQL mirror `go/migrations/000003_sen_chat_durability.sql`.
- Tables: `sen_sessions`, `sen_session_turns`, `sen_chat_attempts`.
- Unique client command; terminal outcome CHECK + immutable trigger.
- APIs: `SendTurn`, `CompleteAttempt`, `ListTurnsAfter`, `GetActiveAttempt`.

JOB_DONE: S03-L1-002

## S03-L1-003 — Sequenced events and checkpoints

- `sen_chat_events` unique `(chat_attempt_id, seq)`; `AppendEventBatch` (max 64) idempotent.
- `ListEventsAfter` after-seq replay.
- `PinCheckpoint` / `LoadCompatibleCheckpoint` / `CompareAndClearCheckpoint`.

JOB_DONE: S03-L1-003

## S03-L1-004 — Crash/idempotency tests

| Criterion | Result |
|---|---|
| duplicate send | PASS |
| duplicate event | PASS |
| terminal callback retry | PASS |
| restart recovery | PASS |

Covering tests in `go/internal/localdb/product/chat_test.go` plus retained AO-14 core/product suite → **33 total**.

JOB_DONE: S03-L1-004

## Timing note (not a blocker)

Long first-run wall clock is operational noise: treat multi-minute silent `rtk go test` as a compile/IO timing concern unless the process is still live past an explicit `-timeout` with no exit. Prefer `go test -timeout … -v` for gate observation. Product correctness is established by exit 0 and 33 passes.

## SHA-256

```text
d9160e63aee84f00c39d827f52fee34123b6330f0691814f65b777de725dec94  go/internal/localdb/product/schema.go
fcf9e5141854f68f8a0f438113bf6d06f6fc6c08087ae498ff69e96375b21561  go/internal/localdb/product/chat.go
0e03f7a971337ddae7ad36417ecab404cc54b068008ed464464691d6a5c6afd6  go/internal/localdb/product/chat_test.go
1536175031c770f256f42aef6bd7a4fa6ac0a56a160358f34ea81bb66e4ec0c0  go/migrations/000003_sen_chat_durability.sql
```

## Dispatch

- task: `task_8d5a1e09fc94`
- dispatch: `ctx_cad0af4c5a18`
- Lane 2/3: not waited on
- No commit

JOB_DONE: S03-L1
