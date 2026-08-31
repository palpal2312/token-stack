# S03-L1 Lane Receipt — SQLite durable chat authority

## Status protocol

- 50%: ADR frozen; schema/API surface designed against ADP-01 and phase-08b SQLite override.
- 80%: Migration v3, typed send/event/checkpoint APIs, and focused crash/idempotency tests landed.
- Blockers: Orca dispatch `ctx_65da68b720a1` capability revoked (`agent_prompt_stalled`) before first heartbeat; coordinator `ask` timed out. Work completed on assigned terminal `term_122c7504-3667-4965-8df6-0eec889b2115`.
- Completion: focused Go tests, vet, and build passed. No commit created.

## Jobs delivered

| Job | Output |
|---|---|
| S03-L1-001 | `plans/reports/sprint03-lane1/S03-L1-001-chat-authority-adr.md` — persist-before-ack, SQLite-only, Orca refs non-canonical, no legacy dual-write |
| S03-L1-002 | Product migration v3 + typed session/turn/attempt records; unique `client_command_id`; terminal outcome constraint/trigger |
| S03-L1-003 | Ordered idempotent event tails (`after_seq`), bounded atomic batch (max 64), compare-and-clear checkpoint APIs |
| S03-L1-004 | Focused Go tests for duplicate send, duplicate/conflict events, terminal retry, restart recovery, checkpoint clear |

## Contract sources

- `plans/260804-0518-sen-news-os-implementation/sprint-03-lane-backlog.json` Lane 1
- `plans/260804-0518-sen-news-os-implementation/orca-first-backlog-reconciliation.md` ADP-01
- `plans/260804-0518-sen-news-os-implementation/phase-08b-durable-sen-chat-sessions-streaming-and-recovery.md` (SQLite override)

## Conformance delivered

- Authority is `sen-product.db` only; AO-14 tables retained; chat durability added as migration version 3.
- Tables: `sen_sessions`, `sen_session_turns`, `sen_chat_attempts`, `sen_chat_events`, `sen_runtime_checkpoints`.
- `SendTurn` persists session touch, user turn, queued attempt, and command receipt before returning.
- Exact send command retries replay the original receipt; conflicting session binding fails closed.
- Event batches are unique on `(chat_attempt_id, seq)`, idempotent on exact retry, reject payload conflicts, and bound at 64.
- Terminal attempt states are immutable via trigger; identical complete-command retries replay; alternate terminal outcomes fail.
- Checkpoint pin/load uses exact `(session_id, builder_id, runtime_profile)`; clear requires matching owning attempt + lease generation.
- SQL mirror: `go/migrations/000003_sen_chat_durability.sql`.

## Verification

Run from `go/` (bounded; prefer explicit `-timeout`):

```text
gofmt -l ./internal/localdb/product/ ./internal/localdb/core/
GOFMT_CLEAN

go test -count=1 -timeout 60s -v ./internal/localdb/product/ -run 'TestSendTurn|TestEventBatch|TestCompleteAttempt|TestCheckpoint|TestChatSchema|TestChatMigration'
ok  agentic-os/internal/localdb/product  7.524s

go test -count=1 -timeout 90s ./internal/localdb/core/ ./internal/localdb/product/
ok  agentic-os/internal/localdb/core     2.451s
ok  agentic-os/internal/localdb/product  6.410s
```

Hang anomaly (PID 23228): cleared — see `S03-L1-004-anomaly-hung-gotest.md` (cold compile + RTK quiet; process already exited 33/33).

## File SHA-256

```text
d9160e63aee84f00c39d827f52fee34123b6330f0691814f65b777de725dec94  go/internal/localdb/product/schema.go
fcf9e5141854f68f8a0f438113bf6d06f6fc6c08087ae498ff69e96375b21561  go/internal/localdb/product/chat.go
0e03f7a971337ddae7ad36417ecab404cc54b068008ed464464691d6a5c6afd6  go/internal/localdb/product/chat_test.go
c33fd53de994c6259ad025c8a062aafd50693fd74d8c83ef3c23df8938be81ea  go/internal/localdb/product/store.go
126c61c737e9329b95d4099ab00f569c5bd49aed9ef71293dc788107b230d9cb  go/internal/localdb/product/database.go
1536175031c770f256f42aef6bd7a4fa6ac0a56a160358f34ea81bb66e4ec0c0  go/migrations/000003_sen_chat_durability.sql
```

Receipt hash intentionally omitted from its own manifest. No commit created.

## Per-job evidence

- `plans/reports/sprint03-lane1/S03-L1-002-schema-report.md`
- `plans/reports/sprint03-lane1/S03-L1-003-events-checkpoints-report.md`
- `plans/reports/sprint03-lane1/S03-L1-004-tests-receipt.md`
- `plans/reports/sprint03-lane1/S03-L1-004-anomaly-hung-gotest.md`

## Files modified / created

- `go/internal/localdb/product/schema.go`
- `go/internal/localdb/product/chat.go` (new; gofmt applied)
- `go/internal/localdb/product/chat_test.go` (new)
- `go/migrations/000003_sen_chat_durability.sql` (new)
- `plans/reports/sprint03-lane1/S03-L1-001-chat-authority-adr.md` (new)
- `plans/reports/sprint03-lane1/S03-L1-002-schema-report.md` (new)
- `plans/reports/sprint03-lane1/S03-L1-003-events-checkpoints-report.md` (new)
- `plans/reports/sprint03-lane1/S03-L1-004-tests-receipt.md` (new)
- `plans/reports/sprint03-lane1/S03-L1-004-receipt.md` (this lane summary)

## Left for other lanes

- Lane 2 / Lane 3: out of scope; not waited on.

## JOB_DONE markers

```text
JOB_DONE: S03-L1-001
JOB_DONE: S03-L1-002
JOB_DONE: S03-L1-003
JOB_DONE: S03-L1-004
JOB_DONE: S03-L1
```

No commit created (explicit task constraint).
