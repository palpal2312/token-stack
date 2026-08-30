package reconcile

import (
	"encoding/json"
	"testing"

	"agentic-os/internal/orca"
)

func TestProjectSlotsObserveOnly(t *testing.T) {
	dto := orca.FixtureRuntimeSlots()
	raw, err := orca.EncodeRuntimeSlots(dto)
	if err != nil {
		t.Fatal(err)
	}
	diag := "observe-only join"
	proj := &Projection{
		Phase:       PhaseObserveOnly,
		ObserveOnly: true,
		Diagnostic:  &diag,
	}
	out, err := ProjectSlots(raw, proj, "orca-lab-0")
	if err != nil {
		t.Fatal(err)
	}
	if out.Reconcile == nil || out.Reconcile.Phase != PhaseObserveOnly {
		t.Fatalf("out=%+v", out)
	}
	encoded, err := EncodeSlotProjection(out)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(encoded, &m); err != nil {
		t.Fatal(err)
	}
	if m["focus_slot"] != "orca-lab-0" {
		t.Fatalf("focus_slot=%v", m["focus_slot"])
	}
	if _, ok := m["dto_version"]; !ok {
		t.Fatal("expected dto_version at top level")
	}
}

func TestProjectSlotsMissingSlot(t *testing.T) {
	raw, err := orca.EncodeRuntimeSlots(orca.FixtureRuntimeSlots())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ProjectSlots(raw, nil, "missing"); err == nil {
		t.Fatal("expected missing slot error")
	}
}

func TestProjectSlotsQuarantinedPhase(t *testing.T) {
	raw, err := orca.EncodeRuntimeSlots(orca.FixtureRuntimeSlots(func(s *orca.Slot) {
		s.State = orca.SlotReconciling
	}))
	if err != nil {
		t.Fatal(err)
	}
	reason := "stale/mismatch quarantine"
	seq := int64(4)
	proj := &Projection{
		Phase:         PhaseQuarantined,
		LastSeq:       &seq,
		ReattachCount: 1,
		ObserveOnly:   true,
		Diagnostic:    &reason,
	}
	out, err := ProjectSlots(raw, proj, "orca-lab-0")
	if err != nil {
		t.Fatal(err)
	}
	if out.Slots.Slots[0].State != orca.SlotReconciling {
		t.Fatalf("state=%s", out.Slots.Slots[0].State)
	}
	if out.Reconcile.Phase != PhaseQuarantined {
		t.Fatalf("phase=%s", out.Reconcile.Phase)
	}
}
