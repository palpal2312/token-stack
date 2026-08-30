package orca

import "testing"

func TestCanonicalPackagePathNotOrcaslots(t *testing.T) {
	if CanonicalPackagePath != "agentic-os/internal/orca" {
		t.Fatalf("canonical=%q", CanonicalPackagePath)
	}
	if LegacyPackagePathAlias == CanonicalPackagePath {
		t.Fatal("legacy alias must differ from canonical")
	}
	if DTOVersion != 1 {
		t.Fatalf("dto_version=%d", DTOVersion)
	}
}

func TestRuntimeSlotsProjectionHelperRoundTrip(t *testing.T) {
	dto := FixtureRuntimeSlots(func(s *Slot) {
		s.State = SlotReconciling
		s.InFlight = 1
	})
	raw, err := EncodeRuntimeSlots(dto)
	if err != nil {
		t.Fatal(err)
	}
	got, err := ParseRuntimeSlots(raw)
	if err != nil {
		t.Fatal(err)
	}
	if got.Slots[0].State != SlotReconciling || got.Slots[0].InFlight != 1 {
		t.Fatalf("slot=%+v", got.Slots[0])
	}
}
