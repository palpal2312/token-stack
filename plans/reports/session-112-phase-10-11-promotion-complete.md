# Session 112 Report: Phase 10-11 Promotion Complete

**Date:** 2026-08-08
**Session:** 112
**Scope:** Promote CommittingDispatcher (Phase 10) and LiveScoringAllocator (Phase 11) from scaffold to production-grade

---

## 1. CommittingDispatcher (Phase 10)

### Design

The `CommittingDispatcher` (`go/internal/scheduler/committing_dispatcher.go`) extends the dry-run scheduler into a production dispatch system with three key additions:

- **Fencing tokens.** Each dispatch call generates a cryptographically random 16-byte hex token and atomically persists it on the Attempt record via `SetFencingToken` (compare-and-swap on empty). This prevents double-dispatch even across process restarts.
- **WIP limits.** Three concurrency axes are enforced before every dispatch: `Global`, `PerGoal`, and `PerAccount`. A zero value means unlimited. Only attempts in `AttemptStatusRunning` count against the caps.
- **Feature-flag mode toggle.** `SetMode(ModeDryRun | ModeCommitting)` switches behaviour at runtime. In dry-run mode the dispatcher evaluates limits, generates tokens, emits events, and logs decisions -- but never mutates the `AttemptStore`. In committing mode every accepted dispatch writes the fencing token through the store.

### Persistence boundary

`AttemptStore` is the single write interface:

| Method | Semantics |
|---|---|
| `Get(id)` | Fetch attempt by ID (nil, nil if missing) |
| `ListActive()` | All queued or running attempts |
| `SetFencingToken(id, token, at)` | CAS write: rejects if a different token already exists |
| `Transition(id, status, at)` | Move attempt to a new lifecycle status |

`MemoryAttemptStore` provides a thread-safe in-memory implementation for tests and early deployment.

### Event spine integration

Every decision (accepted or rejected) publishes a `SchedulerEvent` of type `scheduler_dispatch_decided` through the `EventSink` function, making scheduler behaviour observable by downstream projectors and the activity feed.

### Test evidence (9 tests)

| Test | Asserts |
|---|---|
| `TestDispatch_CommittingMode_PersistsToken` | Token generated, persisted in store, event emitted |
| `TestDispatch_DryRunMode_NoTokenPersisted` | Decision logged but store unmodified |
| `TestDispatch_AlreadyDispatched_Idempotent` | Re-dispatch returns existing token, reason=already_dispatched |
| `TestDispatch_GlobalWIPExceeded` | Rejected when global running >= cap |
| `TestDispatch_PerGoalWIPExceeded` | Rejected when per-goal running >= cap |
| `TestDispatch_PerAccountWIPExceeded` | Rejected when per-account running >= cap |
| `TestDispatch_ZeroLimitsMeansUnlimited` | 50 running attempts, zero limits, dispatch succeeds |
| `TestDispatch_ModeToggle` | Dry-run -> committing toggle at runtime |
| `TestDispatch_FencingTokenConflict` | CAS idempotency on pre-existing token |
| `TestDispatch_NotFound` | Error returned for nonexistent attempt |
| `TestStatus_ReturnsDecisionCounts` | Status payload reflects dispatched/rejected counts |

---

## 2. LiveScoringAllocator (Phase 11)

### Design

The `LiveScoringAllocator` (`go/internal/allocator/live_scoring_allocator.go`) replaces the advisory allocation pass with a production scoring and assignment system:

- **Pluggable scoring.** `ScoringFunc(builder, request) -> float64` lets callers inject quality signals, cost models, or affinity rules. The `DefaultScoringFunc` combines capacity headroom (40% weight) and historical success rate (60% weight). Negative scores mark a builder as ineligible.
- **Minimum score threshold.** A configurable `minScore` floor rejects assignments that would land on a low-quality builder (reason code `score_too_low`).
- **Feature-flag mode toggle.** `SetMode(ModeAdvisory | ModeLive)` gates persistence. Advisory mode evaluates scoring, emits events, and logs decisions, but never writes to the `AllocationStore`. Live mode persists assignments through `AssignBuilder` with CAS semantics.
- **Feedback loop.** `RecordFeedback(FeedbackOutcome)` ingests completion/failure signals and updates builder statistics using an exponential moving average (alpha=0.2) for both success rate and average duration. Active count is decremented on feedback, keeping the capacity model current.

### Scoring formula (DefaultScoringFunc)

```
headroom = (capacity - activeCount) / capacity
score    = 0.6 * successRate + 0.4 * headroom
```

Builders at or over capacity return -1.0 (ineligible).

### Persistence boundary

`AllocationStore` is the write interface:

| Method | Semantics |
|---|---|
| `RecordDecision(dec)` | Persist the full allocation decision with reason code |
| `AssignBuilder(attemptID, builderID, at)` | CAS write: rejects if attempt is assigned to a different builder |

`MemoryAllocationStore` provides a thread-safe in-memory implementation for tests.

### Reason codes

| Code | Meaning |
|---|---|
| `assigned` | Builder selected and persisted (live mode) |
| `no_capacity` | All builders at capacity or ineligible |
| `no_match` | No builders registered |
| `score_too_low` | Best score below minScore threshold |
| `already_assigned` | Attempt already assigned (CAS conflict) |
| `advisory_only` | Would assign, but mode is advisory |

### Test evidence (13 tests)

| Test | Asserts |
|---|---|
| `TestAllocate_LiveMode_AssignsBuilder` | Assignment persisted in store, event emitted, score positive |
| `TestAllocate_AdvisoryMode_NoPersistence` | Decision logged, reason=advisory_only, store empty |
| `TestAllocate_NoBuilders` | reason=no_match, Assigned=false |
| `TestAllocate_AllBuildersAtCapacity` | reason=no_capacity, Assigned=false |
| `TestAllocate_ScoreBelowMinimum` | reason=score_too_low when minScore > best score |
| `TestAllocate_SelectsBestBuilder` | Highest-scoring builder selected over lower-scoring |
| `TestRecordFeedback_UpdatesBuilderStats` | Success rate EMA (0.8 -> 0.84), active count decremented |
| `TestRecordFeedback_Failure_UpdatesSuccessRate` | Failure EMA (0.8 -> 0.64) |
| `TestRecordFeedback_UnknownBuilder_NoError` | Silently ignores removed builders |
| `TestAllocate_ModeToggle` | Advisory -> live toggle at runtime |
| `TestAllocate_CustomScorer` | Pluggable scorer overrides default selection |
| `TestStatus_ReturnsCorrectCounts` | Status payload: assigned/rejected/builder counts |
| `TestAllocate_AssignmentConflict` | CAS rejection for pre-assigned attempt |
| `TestDefaultScoringFunc` | Full capacity -> ineligible, zero capacity -> ineligible, normal -> ~0.80 |

---

## 3. Verification script

**Path:** `plans/scripts/verify-phase-10-11-promotion.sh`

The script runs 9 sequential check groups:

1. Prerequisites (Go toolchain, go.mod)
2. Source file existence (scheduler, allocator)
3. Test file existence
4. `go vet` static analysis on both packages
5. `go build` compilation check on both packages
6. Scheduler unit tests (`go test -v -count=1 ./internal/scheduler/`)
7. Allocator unit tests (`go test -v -count=1 ./internal/allocator/`)
8. Full module build (`go build ./...`)
9. Full module test run (`go test -count=1 ./...`)

---

## 4. Files involved

| File | Role |
|---|---|
| `go/internal/scheduler/committing_dispatcher.go` | Phase 10 CommittingDispatcher implementation |
| `go/internal/scheduler/committing_dispatcher_test.go` | 11 test cases for scheduler |
| `go/internal/allocator/live_scoring_allocator.go` | Phase 11 LiveScoringAllocator implementation |
| `go/internal/allocator/live_scoring_allocator_test.go` | 14 test cases for allocator |
| `plans/scripts/verify-phase-10-11-promotion.sh` | Automated verification script |
| `plans/reports/session-112-phase-10-11-promotion-complete.md` | This report |

---

## 5. Promotion status

Phase 10 (CommittingDispatcher) and Phase 11 (LiveScoringAllocator) are structurally complete. Both packages compile, pass `go vet`, and have comprehensive test suites covering happy paths, edge cases (WIP limits, CAS conflicts, mode toggling, feedback EMA), and status introspection endpoints.
