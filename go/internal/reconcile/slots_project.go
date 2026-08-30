package reconcile

import (
	"encoding/json"
	"errors"
	"fmt"

	"agentic-os/internal/orca"
)

// SlotProjection is a read-only join of RuntimeSlots + optional reconcile
// projection for observe-only consumers.
type SlotProjection struct {
	Slots     orca.RuntimeSlots
	Reconcile *Projection
	FocusSlot string
}

// ProjectSlots builds a read-only join of RuntimeSlots + Projection.
// It never mutates the store; invalid envelopes fail closed.
func ProjectSlots(slotsJSON []byte, proj *Projection, focusSlot string) (SlotProjection, error) {
	slots, err := orca.ParseRuntimeSlots(slotsJSON)
	if err != nil {
		return SlotProjection{}, err
	}
	if proj != nil {
		if err := validateProjection(*proj); err != nil {
			return SlotProjection{}, err
		}
	}
	if focusSlot != "" {
		found := false
		for _, s := range slots.Slots {
			if s.SlotID == focusSlot {
				found = true
				break
			}
		}
		if !found && slots.LabEnabled {
			return SlotProjection{}, fmt.Errorf("slot %q not reported", focusSlot)
		}
	}
	out := SlotProjection{Slots: slots, FocusSlot: focusSlot}
	if proj != nil {
		cp := *proj
		out.Reconcile = &cp
	}
	return out, nil
}

// EncodeSlotProjection emits allowlisted JSON: RuntimeSlots fields at the top
// level plus optional reconcile / focus_slot. Extra keys never appear.
func EncodeSlotProjection(p SlotProjection) ([]byte, error) {
	if p.Reconcile != nil {
		if err := validateProjection(*p.Reconcile); err != nil {
			return nil, err
		}
	}
	type wireSlot struct {
		SlotID         string         `json:"slot_id"`
		State          orca.SlotState `json:"state"`
		Capacity       int            `json:"capacity"`
		InFlight       int            `json:"in_flight"`
		BuilderLabel   *string        `json:"builder_label"`
		AttemptRef     *string        `json:"attempt_ref"`
		LastObservedAt string         `json:"last_observed_at"`
		Reason         *string        `json:"reason"`
	}
	wire := struct {
		DTOVersion int          `json:"dto_version"`
		LabEnabled bool         `json:"lab_enabled"`
		Slots      []wireSlot   `json:"slots"`
		Reconcile  *Projection  `json:"reconcile,omitempty"`
		FocusSlot  string       `json:"focus_slot,omitempty"`
	}{
		DTOVersion: orca.DTOVersion,
		LabEnabled: p.Slots.LabEnabled,
		Slots:      make([]wireSlot, 0, len(p.Slots.Slots)),
		Reconcile:  p.Reconcile,
		FocusSlot:  p.FocusSlot,
	}
	if p.Slots.DTOVersion != 0 && p.Slots.DTOVersion != orca.DTOVersion {
		return nil, fmt.Errorf("unsupported dto_version %d", p.Slots.DTOVersion)
	}
	for _, s := range p.Slots.Slots {
		wire.Slots = append(wire.Slots, wireSlot{
			SlotID: s.SlotID, State: s.State, Capacity: s.Capacity, InFlight: s.InFlight,
			BuilderLabel: s.BuilderLabel, AttemptRef: s.AttemptRef,
			LastObservedAt: s.LastObservedAt, Reason: s.Reason,
		})
	}
	return json.Marshal(wire)
}

func validateProjection(p Projection) error {
	switch p.Phase {
	case PhaseSteady, PhaseReconnecting, PhaseReattaching, PhaseQuarantined, PhaseObserveOnly:
	default:
		return fmt.Errorf("invalid reconcile phase %q", p.Phase)
	}
	if p.LastSeq != nil && *p.LastSeq < 0 {
		return errors.New("last_seq must be >= 0")
	}
	if p.ReattachCount < 0 {
		return errors.New("reattach_count must be >= 0")
	}
	return nil
}
