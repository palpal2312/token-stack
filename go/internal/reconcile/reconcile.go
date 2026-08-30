// Package reconcile implements ADP-05 Orca reattach recovery: compare observed
// Dispatch/terminal state against the durable orca store, quarantine
// stale/mismatch rows, and refuse duplicate active Dispatches.
package reconcile

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"agentic-os/internal/adapter"
	"agentic-os/internal/orca"
)

// Phase is the typed reconcile projection phase vocabulary (ADP-05).
type Phase string

const (
	PhaseSteady       Phase = "steady"
	PhaseReconnecting Phase = "reconnecting"
	PhaseReattaching  Phase = "reattaching"
	PhaseQuarantined  Phase = "quarantined"
	PhaseObserveOnly  Phase = "observe_only"
)

// Projection is the safe observe-only reconcile projection.
type Projection struct {
	Phase           Phase   `json:"phase"`
	LastSeq         *int64  `json:"last_seq"`
	LastReconcileAt *string `json:"last_reconcile_at"`
	ReattachCount   int     `json:"reattach_count"`
	ObserveOnly     bool    `json:"observe_only"`
	Diagnostic      *string `json:"diagnostic"`
}

// Observation is what the runtime currently sees for a worker Dispatch.
type Observation struct {
	RunID              string
	TaskID             string
	DispatchID         string
	TerminalHandle     string
	CapabilityHash     string
	ProcessIncarnation string
	OutputCursor       int64
	CapabilityRevoked  bool
	ObserveOnly        bool
	Now                time.Time
}

// Engine binds a durable orca store for reconcile passes.
type Engine struct {
	Store *orca.Store
}

// Reattach claims or reattaches a Dispatch, then returns the projection.
// Persist-first: ClaimDispatch runs before any projection is returned.
func (e *Engine) Reattach(ctx context.Context, obs Observation) (Projection, orca.Dispatch, error) {
	if e == nil || e.Store == nil {
		return Projection{}, orca.Dispatch{}, errors.New("reconcile engine requires orca store")
	}
	if err := ValidateObservation(obs); err != nil {
		return Projection{}, orca.Dispatch{}, err
	}
	if obs.ObserveOnly {
		return observeOnlyProjection("observe-only mode; no slot mutation"), orca.Dispatch{}, nil
	}
	now := obs.Now
	if now.IsZero() {
		now = time.Now().UTC()
	}

	if obs.CapabilityRevoked {
		if _, err := e.Store.GetDispatch(ctx, obs.DispatchID); err == nil {
			qd, qerr := e.Store.Quarantine(ctx, obs.DispatchID, "capability revoked", now)
			if qerr != nil {
				return Projection{}, orca.Dispatch{}, qerr
			}
			return quarantinedProjection(qd, "capability revoked"), qd, nil
		}
		return quarantinedProjection(orca.Dispatch{}, "capability revoked before claim"), orca.Dispatch{}, nil
	}

	// Stale/mismatch quarantine when a persisted row disagrees before reattach.
	if existing, err := e.Store.GetDispatch(ctx, obs.DispatchID); err == nil {
		if reason := staleMismatch(existing, obs); reason != "" {
			qd, qerr := e.Store.Quarantine(ctx, existing.DispatchID, reason, now)
			if qerr != nil {
				return Projection{}, existing, qerr
			}
			return quarantinedProjection(qd, reason), qd, nil
		}
	}

	d, err := e.Store.ClaimDispatch(ctx, orca.ClaimInput{
		DispatchID:         obs.DispatchID,
		RunID:              obs.RunID,
		TaskID:             obs.TaskID,
		TerminalHandle:     obs.TerminalHandle,
		CapabilityHash:     obs.CapabilityHash,
		ProcessIncarnation: obs.ProcessIncarnation,
		Now:                now,
	})
	var dup *orca.DuplicateDispatchError
	if errors.As(err, &dup) {
		diag := fmt.Sprintf("duplicate dispatch refused: active=%s attempt=%s", dup.ActiveDispatchID, dup.AttemptDispatchID)
		return Projection{
			Phase:       PhaseQuarantined,
			ObserveOnly: true,
			Diagnostic:  &diag,
		}, orca.Dispatch{}, dup
	}
	if err != nil {
		return Projection{}, orca.Dispatch{}, err
	}

	phase := PhaseSteady
	if d.ReattachCount > 0 {
		phase = PhaseReattaching
	}

	if obs.OutputCursor > d.OutputCursor {
		if err := e.Store.AdvanceCursor(ctx, d.DispatchID, obs.TerminalHandle, obs.OutputCursor, now); err != nil {
			return Projection{}, d, err
		}
		d.OutputCursor = obs.OutputCursor
	}

	stamp := now.UTC().Format("2006-01-02T15:04:05.000Z")
	seq := d.OutputCursor
	proj := Projection{
		Phase:           phase,
		LastSeq:         &seq,
		LastReconcileAt: &stamp,
		ReattachCount:   d.ReattachCount,
		ObserveOnly:     false,
	}
	if phase == PhaseReattaching {
		msg := "reattached existing dispatch"
		proj.Diagnostic = &msg
	}
	return proj, d, nil
}

// NegotiateAndPin runs typed capability negotiation then pins the hash.
func (e *Engine) NegotiateAndPin(ctx context.Context, pinID string, offered adapter.Spec, now time.Time) (adapter.Result, error) {
	if e == nil || e.Store == nil {
		return adapter.Result{}, errors.New("reconcile engine requires orca store")
	}
	res := adapter.Negotiate(adapter.DefaultRequired(), offered)
	if !res.Accepted {
		return res, fmt.Errorf("capability negotiation failed: %s", res.Reason)
	}
	raw, err := json.Marshal(res.Features)
	if err != nil {
		return res, err
	}
	if err := e.Store.PinCapability(ctx, pinID, res.ContractVersion, string(raw), res.CapabilityHash, now); err != nil {
		return res, err
	}
	return res, nil
}

func staleMismatch(d orca.Dispatch, obs Observation) string {
	if obs.RunID != "" && d.RunID != obs.RunID {
		return "run id mismatch"
	}
	if obs.TaskID != "" && d.TaskID != obs.TaskID {
		return "task id mismatch"
	}
	if obs.ProcessIncarnation != "" && d.ProcessIncarnation != "" && obs.ProcessIncarnation != d.ProcessIncarnation {
		return "process incarnation mismatch"
	}
	if obs.CapabilityHash != "" && d.CapabilityHash != "" && obs.CapabilityHash != d.CapabilityHash {
		return "capability hash mismatch"
	}
	return ""
}

func quarantinedProjection(d orca.Dispatch, reason string) Projection {
	r := reason
	var seq *int64
	if d.DispatchID != "" {
		s := d.OutputCursor
		seq = &s
	}
	return Projection{
		Phase:         PhaseQuarantined,
		LastSeq:       seq,
		ReattachCount: d.ReattachCount,
		ObserveOnly:   true,
		Diagnostic:    &r,
	}
}

func observeOnlyProjection(reason string) Projection {
	r := reason
	return Projection{
		Phase:       PhaseObserveOnly,
		ObserveOnly: true,
		Diagnostic:  &r,
	}
}
