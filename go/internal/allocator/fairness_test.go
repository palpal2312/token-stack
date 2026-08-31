package allocator

import "testing"

func TestAllocationTieBreakIsStableAndFair(t *testing.T) {
	store := NewMemoryAllocationStore()
	a := NewLiveScoringAllocator(store, ModeLive, func(Builder, AllocationRequest) float64 { return 0.8 }, 0, nil)
	a.RegisterBuilder(Builder{ID: "builder-b", Capacity: 2, ActiveCount: 1})
	a.RegisterBuilder(Builder{ID: "builder-a", Capacity: 2, ActiveCount: 0})
	dec, err := a.Allocate(AllocationRequest{AttemptID: "attempt", GoalID: "goal", AccountID: "account"})
	if err != nil {
		t.Fatal(err)
	}
	if dec.BuilderID != "builder-a" {
		t.Fatalf("expected least-loaded builder-a, got %q", dec.BuilderID)
	}
}
