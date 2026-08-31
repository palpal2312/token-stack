package reconcile

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"agentic-os/internal/adapter"
	"agentic-os/internal/orca"
)

func TestReattachFirstClaimSteady(t *testing.T) {
	eng := openEngine(t)
	defer eng.Store.Close()
	now := time.Date(2026, 8, 25, 14, 0, 0, 0, time.UTC)

	proj, d, err := eng.Reattach(context.Background(), Observation{
		RunID: "run_1", TaskID: "task_1", DispatchID: "ctx_a",
		TerminalHandle: "term_1", CapabilityHash: "deadbeefcafebabe",
		ProcessIncarnation: "inc1", Now: now,
	})
	if err != nil {
		t.Fatal(err)
	}
	if proj.Phase != PhaseSteady {
		t.Fatalf("phase=%s", proj.Phase)
	}
	if d.DispatchID != "ctx_a" {
		t.Fatalf("dispatch=%s", d.DispatchID)
	}
}

func TestReattachIdempotentSecondPass(t *testing.T) {
	eng := openEngine(t)
	defer eng.Store.Close()
	now := time.Date(2026, 8, 25, 14, 0, 0, 0, time.UTC)
	obs := Observation{
		RunID: "run_1", TaskID: "task_1", DispatchID: "ctx_a",
		TerminalHandle: "term_1", CapabilityHash: "deadbeefcafebabe",
		ProcessIncarnation: "inc1", OutputCursor: 3, Now: now,
	}
	if _, _, err := eng.Reattach(context.Background(), obs); err != nil {
		t.Fatal(err)
	}
	obs.Now = now.Add(time.Minute)
	obs.OutputCursor = 7
	proj, d, err := eng.Reattach(context.Background(), obs)
	if err != nil {
		t.Fatal(err)
	}
	if proj.Phase != PhaseReattaching {
		t.Fatalf("phase=%s", proj.Phase)
	}
	if d.ReattachCount != 1 {
		t.Fatalf("reattach_count=%d", d.ReattachCount)
	}
	if proj.LastSeq == nil || *proj.LastSeq != 7 {
		t.Fatalf("last_seq=%v", proj.LastSeq)
	}
}

func TestDuplicateDispatchQuarantineProjection(t *testing.T) {
	eng := openEngine(t)
	defer eng.Store.Close()
	now := time.Date(2026, 8, 25, 14, 0, 0, 0, time.UTC)
	if _, _, err := eng.Reattach(context.Background(), Observation{
		RunID: "run_1", TaskID: "task_1", DispatchID: "ctx_a",
		TerminalHandle: "term_1", Now: now,
	}); err != nil {
		t.Fatal(err)
	}
	proj, _, err := eng.Reattach(context.Background(), Observation{
		RunID: "run_1", TaskID: "task_1", DispatchID: "ctx_b",
		TerminalHandle: "term_2", Now: now.Add(time.Second),
	})
	var dup *orca.DuplicateDispatchError
	if !errors.As(err, &dup) {
		t.Fatalf("expected duplicate error, got %v", err)
	}
	if proj.Phase != PhaseQuarantined || !proj.ObserveOnly {
		t.Fatalf("proj=%+v", proj)
	}
}

func TestStaleMismatchQuarantine(t *testing.T) {
	eng := openEngine(t)
	defer eng.Store.Close()
	now := time.Date(2026, 8, 25, 14, 0, 0, 0, time.UTC)
	if _, _, err := eng.Reattach(context.Background(), Observation{
		RunID: "run_1", TaskID: "task_1", DispatchID: "ctx_a",
		TerminalHandle: "term_1", CapabilityHash: "deadbeefcafebabe",
		ProcessIncarnation: "inc1", Now: now,
	}); err != nil {
		t.Fatal(err)
	}
	proj, d, err := eng.Reattach(context.Background(), Observation{
		RunID: "run_1", TaskID: "task_1", DispatchID: "ctx_a",
		TerminalHandle: "term_1", CapabilityHash: "cafebabedeadbeef",
		ProcessIncarnation: "inc1", Now: now.Add(time.Minute),
	})
	if err != nil {
		t.Fatal(err)
	}
	if proj.Phase != PhaseQuarantined {
		t.Fatalf("phase=%s", proj.Phase)
	}
	if d.Status != orca.StatusQuarantined {
		t.Fatalf("status=%s", d.Status)
	}
}

func TestRevokedCapabilityQuarantine(t *testing.T) {
	eng := openEngine(t)
	defer eng.Store.Close()
	now := time.Date(2026, 8, 25, 14, 0, 0, 0, time.UTC)
	if _, _, err := eng.Reattach(context.Background(), Observation{
		RunID: "run_1", TaskID: "task_1", DispatchID: "ctx_a",
		TerminalHandle: "term_1", Now: now,
	}); err != nil {
		t.Fatal(err)
	}
	proj, d, err := eng.Reattach(context.Background(), Observation{
		RunID: "run_1", TaskID: "task_1", DispatchID: "ctx_a",
		TerminalHandle: "term_1", CapabilityRevoked: true, Now: now.Add(time.Minute),
	})
	if err != nil {
		t.Fatal(err)
	}
	if proj.Phase != PhaseQuarantined || d.Status != orca.StatusQuarantined {
		t.Fatalf("proj=%+v d=%+v", proj, d)
	}
}

func TestNegotiateAndPin(t *testing.T) {
	eng := openEngine(t)
	defer eng.Store.Close()
	now := time.Date(2026, 8, 25, 14, 0, 0, 0, time.UTC)
	res, err := eng.NegotiateAndPin(context.Background(), "pin-s04", adapter.Spec{
		ContractVersion: adapter.CurrentContractVersion,
		Features:        adapter.RequiredFeatures,
	}, now)
	if err != nil {
		t.Fatal(err)
	}
	if !res.Accepted || res.CapabilityHash == "" {
		t.Fatalf("res=%+v", res)
	}
	ok, err := eng.Store.IsCapabilityActive(context.Background(), res.CapabilityHash)
	if err != nil || !ok {
		t.Fatalf("active=%v err=%v", ok, err)
	}
}

func TestReattachRejectsInvalidObservation(t *testing.T) {
	eng := openEngine(t)
	defer eng.Store.Close()
	_, _, err := eng.Reattach(context.Background(), Observation{
		OutputCursor: -1,
	})
	if err == nil {
		t.Fatal("expected validation error")
	}
}

func openEngine(t *testing.T) *Engine {
	t.Helper()
	store, err := orca.Open(context.Background(), filepath.Join(t.TempDir(), "root"))
	if err != nil {
		t.Fatal(err)
	}
	return &Engine{Store: store}
}
