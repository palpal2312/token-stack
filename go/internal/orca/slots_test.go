package orca

import (
	"encoding/json"
	"testing"
)

func TestParseRuntimeSlotsRoundTrip(t *testing.T) {
	dto := FixtureRuntimeSlots(func(s *Slot) {
		s.State = SlotRunning
		s.InFlight = 1
		label := "builder-a"
		s.BuilderLabel = &label
	})
	raw, err := EncodeRuntimeSlots(dto)
	if err != nil {
		t.Fatal(err)
	}
	got, err := ParseRuntimeSlots(raw)
	if err != nil {
		t.Fatal(err)
	}
	if got.DTOVersion != DTOVersion || !got.LabEnabled || len(got.Slots) != 1 {
		t.Fatalf("got=%+v", got)
	}
	if got.Slots[0].State != SlotRunning || got.Slots[0].InFlight != 1 {
		t.Fatalf("slot=%+v", got.Slots[0])
	}
}

func TestParseRuntimeSlotsDropsExtraFields(t *testing.T) {
	raw := []byte(`{
		"dto_version": 1,
		"lab_enabled": true,
		"secret": "should-drop",
		"slots": [{
			"slot_id": "orca-lab-0",
			"state": "free",
			"capacity": 1,
			"in_flight": 0,
			"builder_label": null,
			"attempt_ref": null,
			"last_observed_at": "2026-08-18T00:00:00.000Z",
			"reason": null,
			"command": "rm -rf /"
		}]
	}`)
	got, err := ParseRuntimeSlots(raw)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := EncodeRuntimeSlots(got)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(encoded, &m); err != nil {
		t.Fatal(err)
	}
	if _, ok := m["secret"]; ok {
		t.Fatal("secret leaked")
	}
	slots := m["slots"].([]any)
	slot := slots[0].(map[string]any)
	if _, ok := slot["command"]; ok {
		t.Fatal("command leaked")
	}
}

func TestParseRuntimeSlotsRejectsBadVersion(t *testing.T) {
	_, err := ParseRuntimeSlots([]byte(`{"dto_version":2,"lab_enabled":true,"slots":[]}`))
	if err == nil {
		t.Fatal("expected version reject")
	}
}

func TestParseRuntimeSlotsRejectsUnsafeReason(t *testing.T) {
	raw := []byte(`{
		"dto_version": 1,
		"lab_enabled": true,
		"slots": [{
			"slot_id": "orca-lab-0",
			"state": "free",
			"capacity": 1,
			"in_flight": 0,
			"builder_label": null,
			"attempt_ref": null,
			"last_observed_at": "2026-08-18T00:00:00.000Z",
			"reason": "bad\u0000text"
		}]
	}`)
	if _, err := ParseRuntimeSlots(raw); err == nil {
		t.Fatal("expected unsafe reason reject")
	}
}
