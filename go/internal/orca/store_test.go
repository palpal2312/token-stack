package orca

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func TestClaimDispatchIdempotentReattach(t *testing.T) {
	ctx := context.Background()
	store := openTemp(t)
	defer store.Close()
	now := time.Date(2026, 8, 25, 14, 0, 0, 0, time.UTC)

	in := ClaimInput{
		DispatchID:         "ctx_a",
		RunID:              "run_1",
		TaskID:             "task_1",
		TerminalHandle:     "term_1",
		CapabilityHash:     "hash1",
		ProcessIncarnation: "inc1",
		Now:                now,
	}
	first, err := store.ClaimDispatch(ctx, in)
	if err != nil {
		t.Fatal(err)
	}
	if first.Status != StatusDispatched || first.ReattachCount != 0 {
		t.Fatalf("first=%+v", first)
	}

	in.Now = now.Add(time.Minute)
	in.TerminalHandle = "term_1b"
	second, err := store.ClaimDispatch(ctx, in)
	if err != nil {
		t.Fatal(err)
	}
	if second.ReattachCount != 1 {
		t.Fatalf("reattach_count=%d", second.ReattachCount)
	}
	if second.Status != StatusRunning {
		t.Fatalf("status=%s", second.Status)
	}
	if second.TerminalHandle != "term_1b" {
		t.Fatalf("terminal=%s", second.TerminalHandle)
	}
}

func TestClaimDispatchRejectsDuplicateActive(t *testing.T) {
	ctx := context.Background()
	store := openTemp(t)
	defer store.Close()
	now := time.Date(2026, 8, 25, 14, 0, 0, 0, time.UTC)

	_, err := store.ClaimDispatch(ctx, ClaimInput{
		DispatchID: "ctx_a", RunID: "run_1", TaskID: "task_1",
		TerminalHandle: "term_1", Now: now,
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.ClaimDispatch(ctx, ClaimInput{
		DispatchID: "ctx_b", RunID: "run_1", TaskID: "task_1",
		TerminalHandle: "term_2", Now: now.Add(time.Second),
	})
	var dup *DuplicateDispatchError
	if !errors.As(err, &dup) {
		t.Fatalf("expected DuplicateDispatchError, got %v", err)
	}
	if dup.ActiveDispatchID != "ctx_a" {
		t.Fatalf("active=%s", dup.ActiveDispatchID)
	}
}

func TestAdvanceCursorMonotonic(t *testing.T) {
	ctx := context.Background()
	store := openTemp(t)
	defer store.Close()
	now := time.Date(2026, 8, 25, 14, 0, 0, 0, time.UTC)
	_, err := store.ClaimDispatch(ctx, ClaimInput{
		DispatchID: "ctx_a", RunID: "run_1", TaskID: "task_1",
		TerminalHandle: "term_1", Now: now,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.AdvanceCursor(ctx, "ctx_a", "term_1", 10, now); err != nil {
		t.Fatal(err)
	}
	if err := store.AdvanceCursor(ctx, "ctx_a", "term_1", 5, now); err == nil {
		t.Fatal("expected cursor regression refusal")
	}
	cur, err := store.GetCursor(ctx, "term_1")
	if err != nil {
		t.Fatal(err)
	}
	if cur != 10 {
		t.Fatalf("cursor=%d", cur)
	}
}

func TestQuarantineImmutable(t *testing.T) {
	ctx := context.Background()
	store := openTemp(t)
	defer store.Close()
	now := time.Date(2026, 8, 25, 14, 0, 0, 0, time.UTC)
	_, err := store.ClaimDispatch(ctx, ClaimInput{
		DispatchID: "ctx_a", RunID: "run_1", TaskID: "task_1",
		TerminalHandle: "term_1", Now: now,
	})
	if err != nil {
		t.Fatal(err)
	}
	d, err := store.Quarantine(ctx, "ctx_a", "stale mismatch", now)
	if err != nil {
		t.Fatal(err)
	}
	if d.Status != StatusQuarantined {
		t.Fatalf("status=%s", d.Status)
	}
	// After quarantine, a new dispatch for the same task must be allowed.
	_, err = store.ClaimDispatch(ctx, ClaimInput{
		DispatchID: "ctx_b", RunID: "run_1", TaskID: "task_1",
		TerminalHandle: "term_2", Now: now.Add(time.Minute),
	})
	if err != nil {
		t.Fatalf("expected new claim after quarantine: %v", err)
	}
}

func TestCapabilityPinRevoke(t *testing.T) {
	ctx := context.Background()
	store := openTemp(t)
	defer store.Close()
	now := time.Date(2026, 8, 25, 14, 0, 0, 0, time.UTC)
	if err := store.PinCapability(ctx, "pin1", 1, `["slots.read"]`, "abc", now); err != nil {
		t.Fatal(err)
	}
	ok, err := store.IsCapabilityActive(ctx, "abc")
	if err != nil || !ok {
		t.Fatalf("active=%v err=%v", ok, err)
	}
	if err := store.RevokeCapability(ctx, "pin1", now); err != nil {
		t.Fatal(err)
	}
	ok, err = store.IsCapabilityActive(ctx, "abc")
	if err != nil || ok {
		t.Fatalf("expected revoked, active=%v err=%v", ok, err)
	}
}

func openTemp(t *testing.T) *Store {
	t.Helper()
	ctx := context.Background()
	root := filepath.Join(t.TempDir(), "orca-root")
	store, err := Open(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	return store
}
