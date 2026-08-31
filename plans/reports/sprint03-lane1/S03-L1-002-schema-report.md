# S03-L1-002 Evidence — Durable session/turn/attempt schema

## Status

DONE. Forward migration and typed records landed in `sen-product.db`.

## Delivered

- Product migration version 3 embeds chat durability SQL (mirrored at `go/migrations/000003_sen_chat_durability.sql`).
- Tables: `sen_sessions`, `sen_session_turns`, `sen_chat_attempts` with FK, CHECK, and uniqueness constraints.
- Unique `client_command_id` on attempts; partial unique index on turns when present.
- Terminal attempt states constrained by CHECK + immutable UPDATE trigger.
- Typed APIs: `SendTurn`, `CompleteAttempt`, `ListTurnsAfter`, `GetActiveAttempt`.

## Acceptance

| Criterion | Proof |
|---|---|
| sessions | `sen_sessions` created on Open; workspace conflict fails closed |
| turns | ordered `turn_seq`; user turn inserted in SendTurn transaction |
| chat attempts | queued attempt with immutable input range = user turn seq |
| unique client command | command receipt + attempt UNIQUE; exact retry replays |
| terminal outcome constraint | trigger rejects state change after succeeded/failed/cancelled/no_response |

## Verification

```text
gofmt -l ./internal/localdb/product/ ./internal/localdb/core/
GOFMT_CLEAN

go test -count=1 -timeout 90s ./internal/localdb/core/ ./internal/localdb/product/
ok  agentic-os/internal/localdb/core     2.451s
ok  agentic-os/internal/localdb/product  6.410s
```

## Files

- `go/internal/localdb/product/schema.go`
- `go/internal/localdb/product/chat.go`
- `go/migrations/000003_sen_chat_durability.sql`

## SHA-256

```text
d9160e63aee84f00c39d827f52fee34123b6330f0691814f65b777de725dec94  go/internal/localdb/product/schema.go
fcf9e5141854f68f8a0f438113bf6d06f6fc6c08087ae498ff69e96375b21561  go/internal/localdb/product/chat.go
1536175031c770f256f42aef6bd7a4fa6ac0a56a160358f34ea81bb66e4ec0c0  go/migrations/000003_sen_chat_durability.sql
```

## Timing note (not a blocker)

First full focused run (~7.5 min, PID 23228) exited **0 with 33 passed**. Duration is a timing concern (cold compile + RTK quiet), not a hang. No further process investigation.

JOB_DONE: S03-L1-002
