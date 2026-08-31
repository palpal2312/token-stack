# S11 Phase 1 — merge-readiness fixes receipt

## Status

Merge blockers from the rewrite-baseline review (`review-260831-0206-rewrite-baseline-split.md`)
addressed on `feat/rewrite-baseline` (2026-08-31). Per-fix commits listed; full
verification below. Merge to `master` NOT performed — per-phase gate still
pending.

## Fixes (branch commits)

- `4939d6d` + siblings in `fix(go)`: removed orphan phase-09 packages breaking
  `go build ./...` (`go/cmd/sen-daemon`, unused `go/internal/projections`),
  deleted the duplicate `go/internal/memory/s08b_001-governed-memory.sql`
  (canonical stays `go/migrations/`); made `AdvanceCursor` monotonic with an
  atomic `AND output_cursor < ?` predicate; deduped allocator `RecordFeedback`
  by attempt id; admission `AdmitFair` now sorts a copy, never the caller slice.
- `045a802` `fix(shell)`: `view-session-store` persist now notifies subscribers
  (emit) — mutators no longer leave the UI stale.
- `75f9f3d` `fix(web)`: `src/app/settings/page.tsx` renders a real empty
  read-path snapshot by default; the fabricated demo snapshot is gated behind
  `AGENTIC_OS_ALLOW_TEST_FIXTURE=1` and `NODE_ENV !== "production"`.
- `989ce71` `test(shell)`: node:test suites for `view-session-store` (emit
  regression) and `intent-prefetch` (dedupe/cancel/commit).

## Verification

| Check | Result |
|---|---|
| `go build ./...` | pass |
| `go vet ./...` | pass |
| `go test ./internal/...` | 14/14 packages ok, 0 fail |
| `tsc --noEmit` (touched files) | clean |
| node:test shell suites | 5/5 pass |
| S10 regression `qa/tests/s10-*.test.ts` | 33/33 pass |

## Remaining debt (tracked, not blocking)

- Full node:test coverage for the whole shell/web clusters (only the two flagged
  cores covered); Playwright specs exist for broader surface.
- Unused/speculative Go API (`reconcile.Classify`, `ObservationContract`,
  allocator `ReasonAlreadyAssigned`) retained — covered by tests; cut in a
  later pass if no consumer arrives.
- `tsc --noEmit` full-project baseline still has pre-existing errors outside the
  touched surface (deferred to merge pass).

JOB_DONE: S11 Phase 1 merge-readiness fixes verified on feat/rewrite-baseline;
topic review + incremental merge (Phase 2) is next.