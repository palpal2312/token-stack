package allocator

import (
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func mustAllocate(t *testing.T, a *LiveScoringAllocator, req AllocationRequest) AllocationDecision {
	t.Helper()
	dec, err := a.Allocate(req)
	if err != nil {
		t.Fatalf("Allocate(%q) unexpected error: %v", req.AttemptID, err)
	}
	return dec
}

func makeBuilder(id string, capacity, active int, successRate float64) Builder {
	return Builder{
		ID:          id,
		AccountID:   "default-account",
		Capacity:    capacity,
		ActiveCount: active,
		SuccessRate: successRate,
	}
}

// ---------------------------------------------------------------------------
// Live mode: successful assignment
// ---------------------------------------------------------------------------

func TestAllocate_LiveMode_AssignsBuilder(t *testing.T) {
	store := NewMemoryAllocationStore()

	var events []AllocatorEvent
	sink := func(e AllocatorEvent) { events = append(events, e) }

	alloc := NewLiveScoringAllocator(store, ModeLive, nil, 0.0, sink)
	alloc.RegisterBuilder(makeBuilder("b1", 5, 0, 0.9))

	dec := mustAllocate(t, alloc, AllocationRequest{
		AttemptID: "a1",
		GoalID:    "g1",
		AccountID: "acct1",
	})

	if !dec.Assigned {
		t.Fatal("expected Assigned=true")
	}
	if !dec.Live {
		t.Fatal("expected Live=true")
	}
	if dec.BuilderID != "b1" {
		t.Fatalf("expected BuilderID=b1, got %q", dec.BuilderID)
	}
	if dec.Reason != ReasonAssigned {
		t.Fatalf("expected reason assigned, got %q", dec.Reason)
	}
	if dec.Score <= 0 {
		t.Fatalf("expected positive score, got %f", dec.Score)
	}

	// Verify store persisted the assignment.
	assignedTo, ok := store.GetAssignment("a1")
	if !ok || assignedTo != "b1" {
		t.Fatalf("expected store assignment b1, got %q (ok=%v)", assignedTo, ok)
	}

	// Verify event emitted.
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}
	if events[0].Type != "allocator_decision_made" {
		t.Fatalf("expected event type allocator_decision_made, got %q", events[0].Type)
	}
	if !events[0].Assigned {
		t.Fatal("expected event Assigned=true")
	}
}

// ---------------------------------------------------------------------------
// Advisory mode: decision logged but not persisted
// ---------------------------------------------------------------------------

func TestAllocate_AdvisoryMode_NoPersistence(t *testing.T) {
	store := NewMemoryAllocationStore()
	alloc := NewLiveScoringAllocator(store, ModeAdvisory, nil, 0.0, nil)
	alloc.RegisterBuilder(makeBuilder("b1", 5, 0, 0.9))

	dec := mustAllocate(t, alloc, AllocationRequest{
		AttemptID: "a1",
		GoalID:    "g1",
		AccountID: "acct1",
	})

	if dec.Assigned {
		t.Fatal("advisory mode should not assign")
	}
	if dec.Live {
		t.Fatal("expected Live=false in advisory mode")
	}
	if dec.Reason != ReasonAdvisoryOnly {
		t.Fatalf("expected reason advisory_only, got %q", dec.Reason)
	}

	// No assignment should be persisted.
	_, ok := store.GetAssignment("a1")
	if ok {
		t.Fatal("advisory mode should not persist assignment")
	}
}

// ---------------------------------------------------------------------------
// No builders registered
// ---------------------------------------------------------------------------

func TestAllocate_NoBuilders(t *testing.T) {
	store := NewMemoryAllocationStore()
	alloc := NewLiveScoringAllocator(store, ModeLive, nil, 0.0, nil)

	dec := mustAllocate(t, alloc, AllocationRequest{
		AttemptID: "a1",
		GoalID:    "g1",
		AccountID: "acct1",
	})

	if dec.Assigned {
		t.Fatal("expected Assigned=false with no builders")
	}
	if dec.Reason != ReasonNoMatch {
		t.Fatalf("expected reason no_match, got %q", dec.Reason)
	}
}

// ---------------------------------------------------------------------------
// All builders at capacity
// ---------------------------------------------------------------------------

func TestAllocate_AllBuildersAtCapacity(t *testing.T) {
	store := NewMemoryAllocationStore()
	alloc := NewLiveScoringAllocator(store, ModeLive, nil, 0.0, nil)
	alloc.RegisterBuilder(makeBuilder("b1", 2, 2, 0.9))
	alloc.RegisterBuilder(makeBuilder("b2", 1, 1, 0.8))

	dec := mustAllocate(t, alloc, AllocationRequest{
		AttemptID: "a1",
		GoalID:    "g1",
		AccountID: "acct1",
	})

	if dec.Assigned {
		t.Fatal("expected Assigned=false when all builders at capacity")
	}
	if dec.Reason != ReasonNoCapacity {
		t.Fatalf("expected reason no_capacity, got %q", dec.Reason)
	}
}

// ---------------------------------------------------------------------------
// Score threshold
// ---------------------------------------------------------------------------

func TestAllocate_ScoreBelowMinimum(t *testing.T) {
	store := NewMemoryAllocationStore()
	// Set a high minimum score that the default scorer cannot reach.
	alloc := NewLiveScoringAllocator(store, ModeLive, nil, 0.99, nil)
	alloc.RegisterBuilder(makeBuilder("b1", 5, 4, 0.5))

	dec := mustAllocate(t, alloc, AllocationRequest{
		AttemptID: "a1",
		GoalID:    "g1",
		AccountID: "acct1",
	})

	if dec.Assigned {
		t.Fatal("expected Assigned=false when score below minimum")
	}
	if dec.Reason != ReasonScoreTooLow {
		t.Fatalf("expected reason score_too_low, got %q", dec.Reason)
	}
}

// ---------------------------------------------------------------------------
// Best builder selection
// ---------------------------------------------------------------------------

func TestAllocate_SelectsBestBuilder(t *testing.T) {
	store := NewMemoryAllocationStore()
	alloc := NewLiveScoringAllocator(store, ModeLive, nil, 0.0, nil)

	alloc.RegisterBuilder(makeBuilder("b-low", 5, 4, 0.5))
	alloc.RegisterBuilder(makeBuilder("b-high", 10, 0, 0.95))

	dec := mustAllocate(t, alloc, AllocationRequest{
		AttemptID: "a1",
		GoalID:    "g1",
		AccountID: "acct1",
	})

	if dec.BuilderID != "b-high" {
		t.Fatalf("expected b-high to be selected, got %q", dec.BuilderID)
	}
}

// ---------------------------------------------------------------------------
// Feedback wiring: success updates success rate
// ---------------------------------------------------------------------------

func TestRecordFeedback_UpdatesBuilderStats(t *testing.T) {
	store := NewMemoryAllocationStore()
	alloc := NewLiveScoringAllocator(store, ModeLive, nil, 0.0, nil)

	b := makeBuilder("b1", 5, 2, 0.8)
	alloc.RegisterBuilder(b)

	err := alloc.RecordFeedback(FeedbackOutcome{
		AttemptID:  "a1",
		BuilderID:  "b1",
		Succeeded:  true,
		Duration:   5 * time.Second,
		RecordedAt: time.Now(),
	})
	if err != nil {
		t.Fatalf("RecordFeedback error: %v", err)
	}

	// success rate = 0.2*1.0 + 0.8*0.8 = 0.84
	status := alloc.Status()
	if len(status.Builders) != 1 {
		t.Fatalf("expected 1 builder, got %d", len(status.Builders))
	}
	bs := status.Builders[0]
	if bs.SuccessRate < 0.83 || bs.SuccessRate > 0.85 {
		t.Fatalf("expected success rate ~0.84, got %f", bs.SuccessRate)
	}
	// Active count should be decremented.
	if bs.ActiveCount != 1 {
		t.Fatalf("expected active count 1 (decremented from 2), got %d", bs.ActiveCount)
	}

	// Feedback log should have the entry.
	fb := alloc.FeedbackLog()
	if len(fb) != 1 {
		t.Fatalf("expected 1 feedback entry, got %d", len(fb))
	}
}

// ---------------------------------------------------------------------------
// Feedback for failure
// ---------------------------------------------------------------------------

func TestRecordFeedback_Failure_UpdatesSuccessRate(t *testing.T) {
	store := NewMemoryAllocationStore()
	alloc := NewLiveScoringAllocator(store, ModeLive, nil, 0.0, nil)
	alloc.RegisterBuilder(makeBuilder("b1", 5, 1, 0.8))

	err := alloc.RecordFeedback(FeedbackOutcome{
		AttemptID:  "a1",
		BuilderID:  "b1",
		Succeeded:  false,
		Duration:   3 * time.Second,
		RecordedAt: time.Now(),
	})
	if err != nil {
		t.Fatalf("RecordFeedback error: %v", err)
	}

	// success rate = 0.2*0.0 + 0.8*0.8 = 0.64
	status := alloc.Status()
	bs := status.Builders[0]
	if bs.SuccessRate < 0.63 || bs.SuccessRate > 0.65 {
		t.Fatalf("expected success rate ~0.64, got %f", bs.SuccessRate)
	}
}

// ---------------------------------------------------------------------------
// Feedback for unknown builder (no error)
// ---------------------------------------------------------------------------

func TestRecordFeedback_UnknownBuilder_NoError(t *testing.T) {
	store := NewMemoryAllocationStore()
	alloc := NewLiveScoringAllocator(store, ModeLive, nil, 0.0, nil)

	err := alloc.RecordFeedback(FeedbackOutcome{
		AttemptID:  "a1",
		BuilderID:  "unknown",
		Succeeded:  true,
		RecordedAt: time.Now(),
	})
	if err != nil {
		t.Fatalf("expected no error for unknown builder, got: %v", err)
	}
}

// ---------------------------------------------------------------------------
// Mode toggle at runtime
// ---------------------------------------------------------------------------

func TestAllocate_ModeToggle(t *testing.T) {
	store := NewMemoryAllocationStore()
	alloc := NewLiveScoringAllocator(store, ModeAdvisory, nil, 0.0, nil)
	alloc.RegisterBuilder(makeBuilder("b1", 5, 0, 0.9))

	if alloc.Mode() != ModeAdvisory {
		t.Fatalf("expected ModeAdvisory, got %v", alloc.Mode())
	}

	dec1 := mustAllocate(t, alloc, AllocationRequest{AttemptID: "a1", GoalID: "g1", AccountID: "acct1"})
	if dec1.Assigned {
		t.Fatal("advisory mode should not assign")
	}

	alloc.SetMode(ModeLive)
	if alloc.Mode() != ModeLive {
		t.Fatalf("expected ModeLive, got %v", alloc.Mode())
	}

	dec2 := mustAllocate(t, alloc, AllocationRequest{AttemptID: "a2", GoalID: "g1", AccountID: "acct1"})
	if !dec2.Assigned {
		t.Fatal("live mode should assign")
	}
	if !dec2.Live {
		t.Fatal("expected Live=true after mode toggle")
	}
}

// ---------------------------------------------------------------------------
// Custom scoring function
// ---------------------------------------------------------------------------

func TestAllocate_CustomScorer(t *testing.T) {
	store := NewMemoryAllocationStore()
	// Custom scorer that always returns 1.0 for builder "preferred".
	customScorer := func(b Builder, r AllocationRequest) float64 {
		if b.ID == "preferred" {
			return 1.0
		}
		return 0.1
	}
	alloc := NewLiveScoringAllocator(store, ModeLive, customScorer, 0.0, nil)
	alloc.RegisterBuilder(makeBuilder("regular", 10, 0, 0.99))
	alloc.RegisterBuilder(makeBuilder("preferred", 2, 1, 0.5))

	dec := mustAllocate(t, alloc, AllocationRequest{AttemptID: "a1", GoalID: "g1", AccountID: "acct1"})

	if dec.BuilderID != "preferred" {
		t.Fatalf("expected preferred builder, got %q", dec.BuilderID)
	}
}

// ---------------------------------------------------------------------------
// Status endpoint payload
// ---------------------------------------------------------------------------

func TestStatus_ReturnsCorrectCounts(t *testing.T) {
	store := NewMemoryAllocationStore()
	alloc := NewLiveScoringAllocator(store, ModeLive, nil, 0.0, nil)
	alloc.RegisterBuilder(makeBuilder("b1", 5, 0, 0.9))
	alloc.RegisterBuilder(makeBuilder("b2", 0, 0, 0.5)) // zero capacity

	// One should assign (b1), one should fail (no capacity — b2 is ineligible).
	mustAllocate(t, alloc, AllocationRequest{AttemptID: "a1", GoalID: "g1", AccountID: "acct1"})
	// Remove b1 to force next allocation to fail.
	alloc.RemoveBuilder("b1")
	mustAllocate(t, alloc, AllocationRequest{AttemptID: "a2", GoalID: "g2", AccountID: "acct2"})

	status := alloc.Status()
	if status.Mode != "live" {
		t.Fatalf("expected mode live, got %q", status.Mode)
	}
	if status.TotalDecisions != 2 {
		t.Fatalf("expected 2 total decisions, got %d", status.TotalDecisions)
	}
	if status.AssignedCount != 1 {
		t.Fatalf("expected 1 assigned, got %d", status.AssignedCount)
	}
	if status.RejectedCount != 1 {
		t.Fatalf("expected 1 rejected, got %d", status.RejectedCount)
	}
	if status.BuilderCount != 1 {
		t.Fatalf("expected 1 builder (b2 remains), got %d", status.BuilderCount)
	}
}

// ---------------------------------------------------------------------------
// Assignment CAS conflict
// ---------------------------------------------------------------------------

func TestAllocate_AssignmentConflict(t *testing.T) {
	store := NewMemoryAllocationStore()
	// Pre-assign attempt a1 to a different builder.
	_ = store.AssignBuilder("a1", "b-other", time.Now())

	alloc := NewLiveScoringAllocator(store, ModeLive, nil, 0.0, nil)
	alloc.RegisterBuilder(makeBuilder("b1", 5, 0, 0.9))

	_, err := alloc.Allocate(AllocationRequest{AttemptID: "a1", GoalID: "g1", AccountID: "acct1"})
	if err == nil {
		t.Fatal("expected error for assignment conflict")
	}
}

// ---------------------------------------------------------------------------
// DefaultScoringFunc unit test
// ---------------------------------------------------------------------------

func TestDefaultScoringFunc(t *testing.T) {
	// Full capacity -> ineligible
	score := DefaultScoringFunc(
		Builder{ID: "b1", Capacity: 2, ActiveCount: 2, SuccessRate: 1.0},
		AllocationRequest{},
	)
	if score >= 0 {
		t.Fatalf("expected negative score for full builder, got %f", score)
	}

	// Zero capacity -> ineligible
	score = DefaultScoringFunc(
		Builder{ID: "b2", Capacity: 0, ActiveCount: 0, SuccessRate: 0.5},
		AllocationRequest{},
	)
	if score >= 0 {
		t.Fatalf("expected negative score for zero-capacity builder, got %f", score)
	}

	// Normal case
	score = DefaultScoringFunc(
		Builder{ID: "b3", Capacity: 10, ActiveCount: 2, SuccessRate: 0.8},
		AllocationRequest{},
	)
	// headroom = 8/10 = 0.8; score = 0.6*0.8 + 0.4*0.8 = 0.48 + 0.32 = 0.80
	if score < 0.79 || score > 0.81 {
		t.Fatalf("expected score ~0.80, got %f", score)
	}
}
