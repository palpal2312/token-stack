# S03-L1-003 Evidence — Sequenced events and checkpoints

## Status

DONE. Ordered idempotent event tails and runtime checkpoint APIs landed.

## Delivered

- `sen_chat_events` primary key `(chat_attempt_id, seq)`.
- `AppendEventBatch`: atomic, max 64 events, exact duplicate no-op, conflicting payload fails.
- `ListEventsAfter(attemptID, afterSeq, limit)` returns ascending seq > afterSeq.
- `PinCheckpoint` / `LoadCompatibleCheckpoint` keyed by `(session_id, builder_id, runtime_profile)`.
- `CompareAndClearCheckpoint` retires only on exact owning attempt + lease generation match; mismatch leaves last known-good valid.

## Acceptance

| Criterion | Proof |
|---|---|
| unique attempt+seq | PRIMARY KEY; conflict test rejects payload change |
| after-seq replay | `ListEventsAfter` cursor tests |
| compare-and-clear checkpoint | mismatch clear returns false and keeps valid=1; exact clear retires |
| bounded atomic batch | maxEventBatch=64 enforced; oversized rejected |

## Verification

```text
go test -count=1 -timeout 60s -v ./internal/localdb/product/ \
  -run 'TestEventBatch|TestCheckpoint'
--- PASS: TestEventBatchIdempotencyOrderingAndBound (0.37s)
--- PASS: TestCheckpointPinLoadCompareAndClear (2.31s)

go test -count=1 -timeout 90s ./internal/localdb/core/ ./internal/localdb/product/
ok  agentic-os/internal/localdb/core     2.451s
ok  agentic-os/internal/localdb/product  6.410s
```

Covering tests: `TestEventBatchIdempotencyOrderingAndBound`, `TestCheckpointPinLoadCompareAndClear`.

Consolidated 33-pass suite evidence: `plans/reports/sprint03-lane1/S03-L1-002-004-evidence.md`. First-run multi-minute wall clock is a timing concern only.

JOB_DONE: S03-L1-003

## Files

- `go/internal/localdb/product/chat.go` (`AppendEventBatch`, `ListEventsAfter`, checkpoint APIs)
- `go/internal/localdb/product/schema.go` (events + checkpoints tables)
- `go/internal/localdb/product/chat_test.go`

JOB_DONE: S03-L1-003
