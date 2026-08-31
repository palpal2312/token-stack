# S03-L1-001 Chat authority ADR

## Status

Accepted for Sprint 03 Lane 1 (ADP-01).

## Decision

`sen-product.db` (SQLite, WAL, `synchronous=FULL`) is the only durable conversation authority for SEN Chat. Persist-before-ack is mandatory. Orca Run/Task/Dispatch IDs are execution references only and never replace session/turn/attempt/event rows. The legacy FirstMate/file writer is non-canonical and may run only behind an explicit rollback flag; it must not dual-write.

## Compatibility matrix

| Surface | Authority | Allowed role |
|---|---|---|
| `go/internal/localdb/product` chat tables | Canonical | Session, turn, attempt, sequenced event, runtime checkpoint, command receipt |
| Orca Dispatch / terminal handles | Non-canonical | Runtime lease observation and worker lifecycle refs only |
| Provider / Builder resume tokens | Non-canonical | Stored only inside `sen_runtime_checkpoints` with exact compatibility key |
| Next.js `/api/sen/chat*` | Non-authority | Thin proxy; no model spawn, no filesystem history |
| `localStorage` / UI cache | Non-authority | View preference and optimistic merge only |
| Community Gateway / PostgreSQL | Off critical path | Export/outbox only; never chat history |
| Legacy FirstMate JSONL writer | Legacy | Rollback flag only; never second permanent writer |

## Invariants

1. No success ack before session touch, user turn, queued attempt, and command receipt commit.
2. `client_command_id` is unique; exact retries replay the original receipt; conflicts fail closed.
3. Each attempt owns an immutable input turn range; newer turns cannot join an older retry.
4. Stream events are unique on `(chat_attempt_id, seq)` and replayable via `after_seq`.
5. Terminal outcomes (`succeeded`, `failed`, `cancelled`, `no_response`) commit exactly once; identical terminal retries are no-ops.
6. Checkpoint clear uses compare-and-clear against the exact binding; empty results never erase a last known-good checkpoint.

## Non-goals

Semantic memory, Goal/Task allocation, Herdr process ownership, and PostgreSQL local provisioning remain out of scope (RET-07 / ADP-01 boundary).

## Evidence owners

- Schema/APIs/tests: S03-L1-002..004 under `go/internal/localdb/{product,core}` and `go/migrations`.
- UI/API consumers: Sprint 03 Lane 2.
- Recovery matrix: Sprint 03 Lane 3.
