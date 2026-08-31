// Package reconcile — typed ADP-05 observation/reconcile contract.
//
// Contract rules (fail-closed):
//  1. Mutating reattach requires run/task/dispatch/terminal IDs.
//  2. Output cursors are monotonic non-negative integers.
//  3. Capability bearer strings are never accepted — hashes only.
//  4. Observe-only observations never mutate durable state.
//  5. Revoked capability forces quarantine projection.
//  6. One active Dispatch per Task (duplicate guard lives in orca.Store).
package reconcile

import (
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"
)

const maxIDLen = 128

// ValidateObservation enforces the typed observation contract.
// Observe-only may omit IDs; mutating paths require full identity.
func ValidateObservation(obs Observation) error {
	if obs.OutputCursor < 0 {
		return errors.New("output_cursor must be >= 0")
	}
	if obs.ObserveOnly {
		return nil
	}
	if err := requireID("run_id", obs.RunID); err != nil {
		return err
	}
	if err := requireID("task_id", obs.TaskID); err != nil {
		return err
	}
	if err := requireID("dispatch_id", obs.DispatchID); err != nil {
		return err
	}
	if err := requireID("terminal_handle", obs.TerminalHandle); err != nil {
		return err
	}
	if obs.CapabilityHash != "" {
		if looksLikeBearer(obs.CapabilityHash) {
			return errors.New("capability bearer strings are refused; hash only")
		}
		if err := requireHash(obs.CapabilityHash); err != nil {
			return err
		}
	}
	if obs.ProcessIncarnation != "" && !isSafeID(obs.ProcessIncarnation, 512) {
		return errors.New("invalid process_incarnation")
	}
	return nil
}

func requireID(name, v string) error {
	if !isSafeID(v, maxIDLen) {
		return fmt.Errorf("%s is required and must be a safe id", name)
	}
	return nil
}

func requireHash(v string) error {
	if len(v) < 8 || len(v) > 128 {
		return errors.New("capability_hash length out of range")
	}
	for _, r := range v {
		if (r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F') {
			continue
		}
		return errors.New("capability_hash must be hex")
	}
	return nil
}

func isSafeID(v string, max int) bool {
	if v == "" || utf8.RuneCountInString(v) > max {
		return false
	}
	if strings.ContainsAny(v, "\x00\n\r\t") {
		return false
	}
	return true
}

func looksLikeBearer(v string) bool {
	lower := strings.ToLower(v)
	return strings.HasPrefix(lower, "dcap_") || strings.HasPrefix(lower, "bearer ")
}
