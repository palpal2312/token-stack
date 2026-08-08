package scheduler

import (
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func seedStore(s *MemoryAttemptStore, attempts ...Attempt) {
	for _, a := range attempts {
		s.Put(a)
	}
}

func mustDispatch(t *testing.T, d *CommittingDispatcher, id string) DispatchDecision {
	t.Helper()
	dec, err := d.Dispatch(id)
	if err != nil {
		t.Fatalf("Dispatch(%q) unexpected error: %v", id, err)
	}
	return dec
}

// ---------------------------------------------------------------------------
// Basic dispatch — happy path
// ---------------------------------------------------------------------------

func TestDispatch_CommittingMode_PersistsToken(t *testing.T) {
	store := NewMemoryAttemptStore()
	store.Put(Attempt{
		ID:        "a1",
		GoalID:    "g1",
		AccountID: "acct1",
		Status:    AttemptStatusQueued,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	})

	var events []SchedulerEvent
	sink := func(e SchedulerEvent) { events = append(events, e) }

	d := NewCommittingDispatcher(store, WIPLimits{}, ModeCommitting, sink)

	dec := mustDispatch(t, d, "a1")
	if !dec.Dispatched {
		t.Fatal("expected Dispatched=true")
	}
	if dec.DryRun {
		t.Fatal("expected DryRun=false in committing mode")
	}
	if dec.FencingToken == "" {
		t.Fatal("expected a non-empty fencing token")
	}
	if dec.Reason != "wip_ok" {
		t.Fatalf("expected reason wip_ok, got %q", dec.Reason)
	}

	// Verify the token was persisted.
	persisted, err := store.Get("a1")
	if err != nil {
		t.Fatalf("store.Get: %v", err)
	}
	if persisted.FencingToken != dec.FencingToken {
		t.Fatalf("persisted token %q != decision token %q", persisted.FencingToken, dec.FencingToken)
	}
	if persisted.DispatchedAt == nil {
		t.Fatal("expected DispatchedAt to be set")
	}

	// Verify event was emitted.
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}
	if events[0].Type != "scheduler_dispatch_decided" {
		t.Fatalf("expected event type scheduler_dispatch_decided, got %q", events[0].Type)
	}
	if !events[0].Accepted {
		t.Fatal("expected event Accepted=true")
	}
}

// ---------------------------------------------------------------------------
// Dry-run mode — limits evaluated but no store mutation
// ---------------------------------------------------------------------------

func TestDispatch_DryRunMode_NoTokenPersisted(t *testing.T) {
	store := NewMemoryAttemptStore()
	store.Put(Attempt{
		ID:        "a1",
		GoalID:    "g1",
		AccountID: "acct1",
		Status:    AttemptStatusQueued,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	})

	d := NewCommittingDispatcher(store, WIPLimits{}, ModeDryRun, nil)

	dec := mustDispatch(t, d, "a1")
	if !dec.Dispatched {
		t.Fatal("expected Dispatched=true (dry-run still reports would-dispatch)")
	}
	if !dec.DryRun {
		t.Fatal("expected DryRun=true")
	}

	// Token must NOT be persisted.
	persisted, _ := store.Get("a1")
	if persisted.FencingToken != "" {
		t.Fatalf("dry-run should not persist token, got %q", persisted.FencingToken)
	}
}

// ---------------------------------------------------------------------------
// Idempotent dispatch — already-fenced attempt
// ---------------------------------------------------------------------------

func TestDispatch_AlreadyDispatched_Idempotent(t *testing.T) {
	store := NewMemoryAttemptStore()
	now := time.Now()
	store.Put(Attempt{
		ID:           "a1",
		GoalID:       "g1",
		AccountID:    "acct1",
		Status:       AttemptStatusRunning,
		FencingToken: "existing-token",
		DispatchedAt: &now,
		CreatedAt:    now,
		UpdatedAt:    now,
	})

	d := NewCommittingDispatcher(store, WIPLimits{}, ModeCommitting, nil)
	dec := mustDispatch(t, d, "a1")

	if !dec.Dispatched {
		t.Fatal("expected Dispatched=true for already-dispatched attempt")
	}
	if dec.FencingToken != "existing-token" {
		t.Fatalf("expected existing token, got %q", dec.FencingToken)
	}
	if dec.Reason != "already_dispatched" {
		t.Fatalf("expected reason already_dispatched, got %q", dec.Reason)
	}
}

// ---------------------------------------------------------------------------
// WIP limit: global cap
// ---------------------------------------------------------------------------

func TestDispatch_GlobalWIPExceeded(t *testing.T) {
	store := NewMemoryAttemptStore()
	// Two running attempts already exist.
	store.Put(Attempt{ID: "r1", GoalID: "g1", AccountID: "acct1", Status: AttemptStatusRunning})
	store.Put(Attempt{ID: "r2", GoalID: "g2", AccountID: "acct2", Status: AttemptStatusRunning})
	// Candidate to dispatch.
	store.Put(Attempt{ID: "c1", GoalID: "g3", AccountID: "acct3", Status: AttemptStatusQueued})

	d := NewCommittingDispatcher(store, WIPLimits{Global: 2}, ModeCommitting, nil)
	dec := mustDispatch(t, d, "c1")

	if dec.Dispatched {
		t.Fatal("expected Dispatched=false when global WIP exceeded")
	}
	if dec.Reason != "wip_global_exceeded" {
		t.Fatalf("expected reason wip_global_exceeded, got %q", dec.Reason)
	}
}

// ---------------------------------------------------------------------------
// WIP limit: per-goal cap
// ---------------------------------------------------------------------------

func TestDispatch_PerGoalWIPExceeded(t *testing.T) {
	store := NewMemoryAttemptStore()
	store.Put(Attempt{ID: "r1", GoalID: "goal-A", AccountID: "acct1", Status: AttemptStatusRunning})
	store.Put(Attempt{ID: "c1", GoalID: "goal-A", AccountID: "acct1", Status: AttemptStatusQueued})

	d := NewCommittingDispatcher(store, WIPLimits{PerGoal: 1}, ModeCommitting, nil)
	dec := mustDispatch(t, d, "c1")

	if dec.Dispatched {
		t.Fatal("expected Dispatched=false when per-goal WIP exceeded")
	}
	if dec.Reason != "wip_per_goal_exceeded" {
		t.Fatalf("expected reason wip_per_goal_exceeded, got %q", dec.Reason)
	}
}

// ---------------------------------------------------------------------------
// WIP limit: per-account cap
// ---------------------------------------------------------------------------

func TestDispatch_PerAccountWIPExceeded(t *testing.T) {
	store := NewMemoryAttemptStore()
	store.Put(Attempt{ID: "r1", GoalID: "g1", AccountID: "acct-X", Status: AttemptStatusRunning})
	store.Put(Attempt{ID: "r2", GoalID: "g2", AccountID: "acct-X", Status: AttemptStatusRunning})
	store.Put(Attempt{ID: "c1", GoalID: "g3", AccountID: "acct-X", Status: AttemptStatusQueued})

	d := NewCommittingDispatcher(store, WIPLimits{PerAccount: 2}, ModeCommitting, nil)
	dec := mustDispatch(t, d, "c1")

	if dec.Dispatched {
		t.Fatal("expected Dispatched=false when per-account WIP exceeded")
	}
	if dec.Reason != "wip_per_account_exceeded" {
		t.Fatalf("expected reason wip_per_account_exceeded, got %q", dec.Reason)
	}
}

// ---------------------------------------------------------------------------
// WIP limits: zero means unlimited
// ---------------------------------------------------------------------------

func TestDispatch_ZeroLimitsMeansUnlimited(t *testing.T) {
	store := NewMemoryAttemptStore()
	for i := 0; i < 50; i++ {
		store.Put(Attempt{
			ID:        "r" + string(rune('A'+i)),
			GoalID:    "g1",
			AccountID: "acct1",
			Status:    AttemptStatusRunning,
		})
	}
	store.Put(Attempt{ID: "c1", GoalID: "g1", AccountID: "acct1", Status: AttemptStatusQueued})

	d := NewCommittingDispatcher(store, WIPLimits{}, ModeCommitting, nil)
	dec := mustDispatch(t, d, "c1")

	if !dec.Dispatched {
		t.Fatal("zero limits should allow unlimited dispatch")
	}
}

// ---------------------------------------------------------------------------
// Mode transition at runtime
// ---------------------------------------------------------------------------

func TestDispatch_ModeToggle(t *testing.T) {
	store := NewMemoryAttemptStore()
	store.Put(Attempt{ID: "a1", GoalID: "g1", AccountID: "acct1", Status: AttemptStatusQueued})
	store.Put(Attempt{ID: "a2", GoalID: "g1", AccountID: "acct1", Status: AttemptStatusQueued})

	d := NewCommittingDispatcher(store, WIPLimits{}, ModeDryRun, nil)

	if d.Mode() != ModeDryRun {
		t.Fatalf("expected ModeDryRun, got %v", d.Mode())
	}

	// Dispatch in dry-run — no token persisted.
	dec1 := mustDispatch(t, d, "a1")
	if !dec1.DryRun {
		t.Fatal("expected DryRun=true")
	}
	a1, _ := store.Get("a1")
	if a1.FencingToken != "" {
		t.Fatal("dry-run should not persist token")
	}

	// Toggle to committing.
	d.SetMode(ModeCommitting)
	if d.Mode() != ModeCommitting {
		t.Fatalf("expected ModeCommitting, got %v", d.Mode())
	}

	dec2 := mustDispatch(t, d, "a2")
	if dec2.DryRun {
		t.Fatal("expected DryRun=false after mode toggle")
	}
	a2, _ := store.Get("a2")
	if a2.FencingToken == "" {
		t.Fatal("committing mode should persist token")
	}
}

// ---------------------------------------------------------------------------
// Fencing token CAS conflict
// ---------------------------------------------------------------------------

func TestDispatch_FencingTokenConflict(t *testing.T) {
	store := NewMemoryAttemptStore()
	now := time.Now()
	store.Put(Attempt{
		ID:           "a1",
		GoalID:       "g1",
		AccountID:    "acct1",
		Status:       AttemptStatusQueued,
		FencingToken: "pre-existing",
		DispatchedAt: &now,
		CreatedAt:    now,
		UpdatedAt:    now,
	})

	d := NewCommittingDispatcher(store, WIPLimits{}, ModeCommitting, nil)
	// The attempt already has a token, so Dispatch returns idempotent success.
	dec := mustDispatch(t, d, "a1")
	if dec.FencingToken != "pre-existing" {
		t.Fatalf("expected pre-existing token, got %q", dec.FencingToken)
	}
}

// ---------------------------------------------------------------------------
// Not-found attempt
// ---------------------------------------------------------------------------

func TestDispatch_NotFound(t *testing.T) {
	store := NewMemoryAttemptStore()
	d := NewCommittingDispatcher(store, WIPLimits{}, ModeCommitting, nil)
	_, err := d.Dispatch("nonexistent")
	if err == nil {
		t.Fatal("expected error for nonexistent attempt")
	}
}

// ---------------------------------------------------------------------------
// Status introspection
// ---------------------------------------------------------------------------

func TestStatus_ReturnsDecisionCounts(t *testing.T) {
	store := NewMemoryAttemptStore()
	store.Put(Attempt{ID: "a1", GoalID: "g1", AccountID: "acct1", Status: AttemptStatusQueued})
	store.Put(Attempt{ID: "a2", GoalID: "g2", AccountID: "acct2", Status: AttemptStatusQueued})

	d := NewCommittingDispatcher(store, WIPLimits{Global: 1}, ModeCommitting, nil)

	mustDispatch(t, d, "a1")
	// a1 is now dispatched and running in the store; mark it running so WIP counts.
	_ = store.Transition("a1", AttemptStatusRunning, time.Now())
	mustDispatch(t, d, "a2") // should be rejected by global WIP

	status := d.Status()
	if status.Mode != "committing" {
		t.Fatalf("expected mode committing, got %q", status.Mode)
	}
	if status.TotalDecisions != 2 {
		t.Fatalf("expected 2 total decisions, got %d", status.TotalDecisions)
	}
	if status.DispatchedCount != 1 {
		t.Fatalf("expected 1 dispatched, got %d", status.DispatchedCount)
	}
	if status.RejectedCount != 1 {
		t.Fatalf("expected 1 rejected, got %d", status.RejectedCount)
	}
	if len(status.RecentDecisions) != 2 {
		t.Fatalf("expected 2 recent decisions, got %d", len(status.RecentDecisions))
	}
}
