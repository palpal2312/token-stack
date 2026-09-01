# S15 Phase 1 — canonical chat DTO alignment receipt

## Status
DONE (code review CONDITIONAL resolved). sen-plane /api/v1/sen/chat now emits
`turn_id`, `chat_attempt_id`, `status` from the durable product receipt; the
adapter maps only real PKs (never synthesized). Tests wired into `npm test`
(58/58). Code-reviewer HIGH findings closed; MED (dev:canonical SEN_DAEMON_URL
propagation) documented in the S15 plan phase 1 as dev-tooling follow-up.

## Verification
go test ./cmd/sen-plane ok · adapter 2/2 · full suite 58/58 · tsc clean.

## Note
`agent-kanban/dispatch` POST shape (no `sessionId`) 400s when daemon mode is
active — pre-existing since S12 delegation; becomes visible only when
SEN_DAEMON_URL is defaulted (S15 P2); tracked.

JOB_DONE: S15 Phase 1 DTO alignment delivered and reviewed.
