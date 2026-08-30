package orca

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	maxReasonLen = 200
	maxLabelLen  = 200
	maxSlotIDLen = 128
)

var allowedSlotStates = map[SlotState]bool{
	SlotFree: true, SlotReserved: true, SlotLaunching: true,
	SlotRunning: true, SlotReconciling: true, SlotDraining: true,
}

// ParseRuntimeSlots fail-closed parses the /api/v1/runtime/slots envelope.
// Unknown extra JSON fields are dropped; any required-field violation returns
// an error. Secrets and non-allowlisted keys never round-trip.
func ParseRuntimeSlots(raw []byte) (RuntimeSlots, error) {
	if len(raw) == 0 {
		return RuntimeSlots{}, errors.New("runtime slots payload is empty")
	}
	var wire struct {
		DTOVersion *int  `json:"dto_version"`
		LabEnabled *bool `json:"lab_enabled"`
		Slots      []struct {
			SlotID         *string `json:"slot_id"`
			State          *string `json:"state"`
			Capacity       *int    `json:"capacity"`
			InFlight       *int    `json:"in_flight"`
			BuilderLabel   *string `json:"builder_label"`
			AttemptRef     *string `json:"attempt_ref"`
			LastObservedAt *string `json:"last_observed_at"`
			Reason         *string `json:"reason"`
		} `json:"slots"`
	}
	if err := json.Unmarshal(raw, &wire); err != nil {
		return RuntimeSlots{}, fmt.Errorf("decode runtime slots: %w", err)
	}
	if wire.DTOVersion == nil || *wire.DTOVersion != DTOVersion {
		return RuntimeSlots{}, fmt.Errorf("unsupported dto_version")
	}
	if wire.LabEnabled == nil {
		return RuntimeSlots{}, errors.New("lab_enabled is required")
	}
	if wire.Slots == nil {
		return RuntimeSlots{}, errors.New("slots array is required")
	}
	out := RuntimeSlots{
		DTOVersion: DTOVersion,
		LabEnabled: *wire.LabEnabled,
		Slots:      make([]Slot, 0, len(wire.Slots)),
	}
	for i, s := range wire.Slots {
		slot, err := parseSlot(s.SlotID, s.State, s.Capacity, s.InFlight, s.BuilderLabel, s.AttemptRef, s.LastObservedAt, s.Reason)
		if err != nil {
			return RuntimeSlots{}, fmt.Errorf("slot[%d]: %w", i, err)
		}
		out.Slots = append(out.Slots, slot)
	}
	return out, nil
}

// EncodeRuntimeSlots emits the allowlisted wire JSON for a RuntimeSlots value.
func EncodeRuntimeSlots(dto RuntimeSlots) ([]byte, error) {
	if dto.DTOVersion != DTOVersion {
		return nil, fmt.Errorf("unsupported dto_version %d", dto.DTOVersion)
	}
	type wireSlot struct {
		SlotID         string    `json:"slot_id"`
		State          SlotState `json:"state"`
		Capacity       int       `json:"capacity"`
		InFlight       int       `json:"in_flight"`
		BuilderLabel   *string   `json:"builder_label"`
		AttemptRef     *string   `json:"attempt_ref"`
		LastObservedAt string    `json:"last_observed_at"`
		Reason         *string   `json:"reason"`
	}
	wire := struct {
		DTOVersion int        `json:"dto_version"`
		LabEnabled bool       `json:"lab_enabled"`
		Slots      []wireSlot `json:"slots"`
	}{
		DTOVersion: DTOVersion,
		LabEnabled: dto.LabEnabled,
		Slots:      make([]wireSlot, 0, len(dto.Slots)),
	}
	for _, s := range dto.Slots {
		if !allowedSlotStates[s.State] {
			return nil, fmt.Errorf("invalid slot state %q", s.State)
		}
		wire.Slots = append(wire.Slots, wireSlot{
			SlotID: s.SlotID, State: s.State, Capacity: s.Capacity, InFlight: s.InFlight,
			BuilderLabel: s.BuilderLabel, AttemptRef: s.AttemptRef,
			LastObservedAt: s.LastObservedAt, Reason: s.Reason,
		})
	}
	return json.Marshal(wire)
}

// FixtureRuntimeSlots returns a deterministic lab slot for tests/fixtures.
func FixtureRuntimeSlots(overrides ...func(*Slot)) RuntimeSlots {
	slot := Slot{
		SlotID:         "orca-lab-0",
		State:          SlotFree,
		Capacity:       1,
		InFlight:       0,
		LastObservedAt: "2026-08-18T00:00:00.000Z",
	}
	for _, fn := range overrides {
		fn(&slot)
	}
	return RuntimeSlots{DTOVersion: DTOVersion, LabEnabled: true, Slots: []Slot{slot}}
}

func parseSlot(
	slotID, state *string,
	capacity, inFlight *int,
	builderLabel, attemptRef, lastObservedAt, reason *string,
) (Slot, error) {
	if slotID == nil || !isSafeText(*slotID, maxSlotIDLen) {
		return Slot{}, errors.New("invalid slot_id")
	}
	if state == nil || !allowedSlotStates[SlotState(*state)] {
		return Slot{}, errors.New("invalid state")
	}
	if capacity == nil || *capacity < 0 {
		return Slot{}, errors.New("invalid capacity")
	}
	if inFlight == nil || *inFlight < 0 {
		return Slot{}, errors.New("invalid in_flight")
	}
	if lastObservedAt == nil || !isRFC3339UTC(*lastObservedAt) {
		return Slot{}, errors.New("invalid last_observed_at")
	}
	if builderLabel != nil && !isSafeText(*builderLabel, maxLabelLen) {
		return Slot{}, errors.New("invalid builder_label")
	}
	if attemptRef != nil && !isSafeText(*attemptRef, maxSlotIDLen) {
		return Slot{}, errors.New("invalid attempt_ref")
	}
	if reason != nil && !isSafeText(*reason, maxReasonLen) {
		return Slot{}, errors.New("invalid reason")
	}
	return Slot{
		SlotID:         *slotID,
		State:          SlotState(*state),
		Capacity:       *capacity,
		InFlight:       *inFlight,
		BuilderLabel:   builderLabel,
		AttemptRef:     attemptRef,
		LastObservedAt: *lastObservedAt,
		Reason:         reason,
	}, nil
}

func isSafeText(v string, max int) bool {
	if v == "" || utf8.RuneCountInString(v) > max {
		return false
	}
	return !strings.ContainsAny(v, "\x00\x01\x02\x03\x04\x05\x06\x07\x08\x0b\x0c\x0e\x0f")
}

func isRFC3339UTC(v string) bool {
	if _, err := time.Parse(time.RFC3339Nano, v); err == nil {
		return true
	}
	_, err := time.Parse(time.RFC3339, v)
	return err == nil
}
