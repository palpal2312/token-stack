package admission

import (
	"errors"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestApprovalRaceExpiryCrashAndACL(t *testing.T) {
	path := filepath.Join(t.TempDir(), "s08a_001.json")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	a, err := s.Create(Approval{ID: "a1", TenantID: "tenant-a", RequesterID: "requester", IdempotencyKey: "key", PayloadHash: "hash", ExpiresAt: now.Add(time.Hour)})
	if err != nil || a.Status != Pending {
		t.Fatalf("create: %#v %v", a, err)
	}
	if _, err = s.Create(Approval{ID: "other", TenantID: "tenant-a", RequesterID: "requester", IdempotencyKey: "key", PayloadHash: "different", ExpiresAt: now.Add(time.Hour)}); !errors.Is(err, ErrIdempotencyConflict) {
		t.Fatalf("expected idempotency conflict, got %v", err)
	}
	if _, err = s.Decide("tenant-b", "reviewer", "a1", Approved, now); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("expected ACL denial, got %v", err)
	}
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for _, decision := range []Status{Approved, Rejected} {
		wg.Add(1)
		go func(d Status) { defer wg.Done(); _, e := s.Decide("tenant-a", "reviewer", "a1", d, now); results <- e }(decision)
	}
	wg.Wait()
	close(results)
	wins := 0
	for e := range results {
		if e == nil {
			wins++
		} else if !errors.Is(e, ErrAlreadyDecided) {
			t.Fatalf("unexpected race result %v", e)
		}
	}
	if wins != 1 {
		t.Fatalf("expected one decision winner, got %d", wins)
	}
	reopened, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	got, err := reopened.Get("tenant-a", "a1")
	if err != nil || got.Status == Pending {
		t.Fatalf("decision not durable after crash/reopen: %#v %v", got, err)
	}
	_, _ = reopened.Create(Approval{ID: "expired", TenantID: "tenant-a", RequesterID: "requester", IdempotencyKey: "expired-key", PayloadHash: "hash", ExpiresAt: now.Add(-time.Second)})
	if _, err = reopened.Decide("tenant-a", "reviewer", "expired", Approved, now); !errors.Is(err, ErrExpired) {
		t.Fatalf("expected expiry, got %v", err)
	}
	if len(reopened.Audit("tenant-a")) < 4 {
		t.Fatal("expected tenant-scoped audit trail")
	}
}

func TestAdmissionFairnessWIPAndBudget(t *testing.T) {
	now := time.Now()
	pending := []Request{{ID: "busy", TenantID: "busy", CreatedAt: now, EstimatedCost: 2}, {ID: "idle", TenantID: "idle", CreatedAt: now.Add(time.Second), EstimatedCost: 2}}
	admitted, err := AdmitFair(pending, map[string]int{"busy": 1, "idle": 0}, 1, 2, 0, 10)
	if err != nil || len(admitted) != 1 || admitted[0].ID != "idle" {
		t.Fatalf("fair admission = %#v, %v", admitted, err)
	}
	if _, err := AdmitFair(pending, map[string]int{}, 2, 2, 9, 10); !errors.Is(err, ErrBudgetExceeded) {
		t.Fatalf("expected budget breach, got %v", err)
	}
	blocked := []Request{{ID: "busy", TenantID: "busy", CreatedAt: now, EstimatedCost: 2}}
	if _, err := AdmitFair(blocked, map[string]int{"busy": 2}, 1, 2, 0, 10); !errors.Is(err, ErrWIPExceeded) {
		t.Fatalf("expected WIP breach, got %v", err)
	}
}
