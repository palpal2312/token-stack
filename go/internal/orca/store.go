// Package orca is the Lane 1 durable authority for Orca dispatch IDs,
// terminal output cursors, capability pins, and runtime slot DTOs.
//
// Ownership: go/internal/orca (not go/internal/orcaslots). The TypeScript
// client historically mirrored "orcaslots"; consumers should re-point to this
// package. Secrets and raw dispatch capabilities are never persisted — only
// opaque capability hashes and safe slot fields.
package orca

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"agentic-os/internal/localdb/core"
)

const (
	DatabaseName = "orca-runtime.db"
	DTOVersion   = 1
	tsLayout     = "2006-01-02T15:04:05.000Z"
)

// SlotState mirrors the daemon-side slot vocabulary used by orca-slot-client.ts.
type SlotState string

const (
	SlotFree        SlotState = "free"
	SlotReserved    SlotState = "reserved"
	SlotLaunching   SlotState = "launching"
	SlotRunning     SlotState = "running"
	SlotReconciling SlotState = "reconciling"
	SlotDraining    SlotState = "draining"
)

// Slot is the safe read DTO for one runtime slot.
type Slot struct {
	SlotID         string    `json:"slot_id"`
	State          SlotState `json:"state"`
	Capacity       int       `json:"capacity"`
	InFlight       int       `json:"in_flight"`
	BuilderLabel   *string   `json:"builder_label"`
	AttemptRef     *string   `json:"attempt_ref"`
	LastObservedAt string    `json:"last_observed_at"`
	Reason         *string   `json:"reason"`
}

// RuntimeSlots is the wire envelope for /api/v1/runtime/slots.
type RuntimeSlots struct {
	DTOVersion int    `json:"dto_version"`
	LabEnabled bool   `json:"lab_enabled"`
	Slots      []Slot `json:"slots"`
}

// DispatchStatus is the durable lifecycle of one Dispatch row.
type DispatchStatus string

const (
	StatusDispatched  DispatchStatus = "dispatched"
	StatusRunning     DispatchStatus = "running"
	StatusSucceeded   DispatchStatus = "succeeded"
	StatusFailed      DispatchStatus = "failed"
	StatusQuarantined DispatchStatus = "quarantined"
	StatusFenced      DispatchStatus = "fenced"
)

// Dispatch is one persisted Orca Dispatch identity + cursor.
type Dispatch struct {
	DispatchID         string
	RunID              string
	TaskID             string
	TerminalHandle     string
	CapabilityHash     string
	ProcessIncarnation string
	Status             DispatchStatus
	OutputCursor       int64
	ReattachCount      int
	QuarantineReason   string
	CreatedAt          time.Time
	UpdatedAt          time.Time
	CompletedAt        *time.Time
}

// ClaimInput binds a Dispatch before any side effects (persist-first).
type ClaimInput struct {
	DispatchID         string
	RunID              string
	TaskID             string
	TerminalHandle     string
	CapabilityHash     string
	ProcessIncarnation string
	Now                time.Time
}

// Store is the SQLite-backed Orca persistence surface.
type Store struct {
	db *sql.DB
}

// Open creates or opens orca-runtime.db beneath root and migrates schema.
func Open(ctx context.Context, root string) (*Store, error) {
	if root == "" {
		return nil, errors.New("orca database root is required")
	}
	path := filepath.Join(root, DatabaseName)
	db, err := core.Open(ctx, path)
	if err != nil {
		return nil, err
	}
	if err := core.IntegrityCheck(ctx, db); err != nil {
		db.Close()
		return nil, fmt.Errorf("verify orca database: %w", err)
	}
	if err := core.Migrate(ctx, db, migrations); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate orca database: %w", err)
	}
	return &Store{db: db}, nil
}

// Close closes the underlying database.
func (s *Store) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

// DB exposes the connection for tests and reconcile helpers.
func (s *Store) DB() *sql.DB {
	if s == nil {
		return nil
	}
	return s.db
}

// ClaimDispatch persists a Dispatch before use. Exact same DispatchID is an
// idempotent reattach. A different active Dispatch for the same Task fails
// closed (duplicate-Dispatch prevention).
func (s *Store) ClaimDispatch(ctx context.Context, in ClaimInput) (Dispatch, error) {
	if s == nil || s.db == nil {
		return Dispatch{}, errors.New("orca store is required")
	}
	if in.DispatchID == "" || in.RunID == "" || in.TaskID == "" || in.TerminalHandle == "" {
		return Dispatch{}, errors.New("dispatch, run, task, and terminal are required")
	}
	now := in.Now.UTC()
	if now.IsZero() {
		now = time.Now().UTC()
	}
	stamp := now.Format(tsLayout)

	existing, err := s.GetDispatch(ctx, in.DispatchID)
	if err == nil {
		if existing.TaskID != in.TaskID || existing.RunID != in.RunID {
			return Dispatch{}, fmt.Errorf("dispatch identity mismatch for %s", in.DispatchID)
		}
		if existing.Status == StatusQuarantined || existing.Status == StatusFenced ||
			existing.Status == StatusSucceeded || existing.Status == StatusFailed {
			return Dispatch{}, fmt.Errorf("dispatch %s is terminal (%s)", in.DispatchID, existing.Status)
		}
		existing.ReattachCount++
		existing.TerminalHandle = in.TerminalHandle
		if in.CapabilityHash != "" {
			existing.CapabilityHash = in.CapabilityHash
		}
		if in.ProcessIncarnation != "" {
			existing.ProcessIncarnation = in.ProcessIncarnation
		}
		existing.Status = StatusRunning
		existing.UpdatedAt = now
		if err := s.updateDispatch(ctx, existing); err != nil {
			return Dispatch{}, err
		}
		if err := s.upsertCursor(ctx, existing.TerminalHandle, existing.DispatchID, existing.OutputCursor, stamp); err != nil {
			return Dispatch{}, err
		}
		return existing, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return Dispatch{}, err
	}

	active, aerr := s.ActiveDispatchForTask(ctx, in.TaskID)
	if aerr == nil && active.DispatchID != in.DispatchID {
		return Dispatch{}, &DuplicateDispatchError{
			TaskID:            in.TaskID,
			ActiveDispatchID:  active.DispatchID,
			AttemptDispatchID: in.DispatchID,
		}
	}
	if aerr != nil && !errors.Is(aerr, sql.ErrNoRows) {
		return Dispatch{}, aerr
	}

	d := Dispatch{
		DispatchID:         in.DispatchID,
		RunID:              in.RunID,
		TaskID:             in.TaskID,
		TerminalHandle:     in.TerminalHandle,
		CapabilityHash:     in.CapabilityHash,
		ProcessIncarnation: in.ProcessIncarnation,
		Status:             StatusDispatched,
		OutputCursor:       0,
		ReattachCount:      0,
		CreatedAt:          now,
		UpdatedAt:          now,
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO orca_dispatches(
		dispatch_id, run_id, task_id, terminal_handle, capability_hash, process_incarnation,
		status, output_cursor, reattach_count, quarantine_reason, created_at, updated_at, completed_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, ?, ?, NULL)`,
		d.DispatchID, d.RunID, d.TaskID, d.TerminalHandle, nullString(d.CapabilityHash),
		d.ProcessIncarnation, d.Status, stamp, stamp)
	if err != nil {
		if isUniqueViolation(err) {
			return Dispatch{}, &DuplicateDispatchError{
				TaskID:            in.TaskID,
				AttemptDispatchID: in.DispatchID,
			}
		}
		return Dispatch{}, fmt.Errorf("insert dispatch: %w", err)
	}
	if err := s.upsertCursor(ctx, d.TerminalHandle, d.DispatchID, 0, stamp); err != nil {
		return Dispatch{}, err
	}
	return d, nil
}

// DuplicateDispatchError signals an attempt to bind a second active Dispatch.
type DuplicateDispatchError struct {
	TaskID            string
	ActiveDispatchID  string
	AttemptDispatchID string
}

func (e *DuplicateDispatchError) Error() string {
	if e.ActiveDispatchID == "" {
		return fmt.Sprintf("duplicate active dispatch for task %s (attempt %s)", e.TaskID, e.AttemptDispatchID)
	}
	return fmt.Sprintf(
		"duplicate active dispatch for task %s: active=%s attempt=%s",
		e.TaskID, e.ActiveDispatchID, e.AttemptDispatchID,
	)
}

// GetDispatch loads one Dispatch by ID.
func (s *Store) GetDispatch(ctx context.Context, dispatchID string) (Dispatch, error) {
	row := s.db.QueryRowContext(ctx, `SELECT dispatch_id, run_id, task_id, terminal_handle,
		COALESCE(capability_hash, ''), process_incarnation, status, output_cursor, reattach_count,
		COALESCE(quarantine_reason, ''), created_at, updated_at, completed_at
		FROM orca_dispatches WHERE dispatch_id = ?`, dispatchID)
	return scanDispatch(row)
}

// ActiveDispatchForTask returns the non-terminal Dispatch for a task, if any.
func (s *Store) ActiveDispatchForTask(ctx context.Context, taskID string) (Dispatch, error) {
	row := s.db.QueryRowContext(ctx, `SELECT dispatch_id, run_id, task_id, terminal_handle,
		COALESCE(capability_hash, ''), process_incarnation, status, output_cursor, reattach_count,
		COALESCE(quarantine_reason, ''), created_at, updated_at, completed_at
		FROM orca_dispatches
		WHERE task_id = ? AND status IN ('dispatched', 'running')
		ORDER BY created_at DESC LIMIT 1`, taskID)
	return scanDispatch(row)
}

// AdvanceCursor monotonically advances the terminal and dispatch cursors.
func (s *Store) AdvanceCursor(ctx context.Context, dispatchID, terminal string, cursor int64, now time.Time) error {
	if cursor < 0 {
		return errors.New("cursor must be >= 0")
	}
	d, err := s.GetDispatch(ctx, dispatchID)
	if err != nil {
		return err
	}
	if cursor < d.OutputCursor {
		return fmt.Errorf("cursor regression refused: have %d got %d", d.OutputCursor, cursor)
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}
	stamp := now.UTC().Format(tsLayout)
	_, err = s.db.ExecContext(ctx,
		`UPDATE orca_dispatches SET output_cursor = ?, updated_at = ? WHERE dispatch_id = ?`,
		cursor, stamp, dispatchID)
	if err != nil {
		return fmt.Errorf("advance dispatch cursor: %w", err)
	}
	return s.upsertCursor(ctx, terminal, dispatchID, cursor, stamp)
}

// GetCursor returns the persisted terminal output cursor.
func (s *Store) GetCursor(ctx context.Context, terminal string) (int64, error) {
	var cursor int64
	err := s.db.QueryRowContext(ctx,
		`SELECT output_cursor FROM orca_terminal_cursors WHERE terminal_handle = ?`, terminal).Scan(&cursor)
	if err != nil {
		return 0, err
	}
	return cursor, nil
}

// Quarantine marks a Dispatch quarantined with an immutable terminal reason.
func (s *Store) Quarantine(ctx context.Context, dispatchID, reason string, now time.Time) (Dispatch, error) {
	if reason == "" {
		return Dispatch{}, errors.New("quarantine reason is required")
	}
	d, err := s.GetDispatch(ctx, dispatchID)
	if err != nil {
		return Dispatch{}, err
	}
	if d.Status == StatusQuarantined {
		return d, nil
	}
	if d.Status == StatusSucceeded || d.Status == StatusFailed || d.Status == StatusFenced {
		return Dispatch{}, fmt.Errorf("cannot quarantine terminal dispatch %s (%s)", dispatchID, d.Status)
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}
	stamp := now.UTC().Format(tsLayout)
	_, err = s.db.ExecContext(ctx, `UPDATE orca_dispatches
		SET status = 'quarantined', quarantine_reason = ?, updated_at = ?, completed_at = ?
		WHERE dispatch_id = ?`, reason, stamp, stamp, dispatchID)
	if err != nil {
		return Dispatch{}, fmt.Errorf("quarantine dispatch: %w", err)
	}
	return s.GetDispatch(ctx, dispatchID)
}

// Complete marks a Dispatch succeeded or failed exactly once.
func (s *Store) Complete(ctx context.Context, dispatchID string, status DispatchStatus, now time.Time) (Dispatch, error) {
	if status != StatusSucceeded && status != StatusFailed && status != StatusFenced {
		return Dispatch{}, fmt.Errorf("invalid completion status %s", status)
	}
	d, err := s.GetDispatch(ctx, dispatchID)
	if err != nil {
		return Dispatch{}, err
	}
	if d.Status == status {
		return d, nil
	}
	if d.Status == StatusQuarantined || d.Status == StatusSucceeded || d.Status == StatusFailed || d.Status == StatusFenced {
		return Dispatch{}, fmt.Errorf("dispatch %s already terminal (%s)", dispatchID, d.Status)
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}
	stamp := now.UTC().Format(tsLayout)
	_, err = s.db.ExecContext(ctx, `UPDATE orca_dispatches
		SET status = ?, updated_at = ?, completed_at = ? WHERE dispatch_id = ?`,
		status, stamp, stamp, dispatchID)
	if err != nil {
		return Dispatch{}, err
	}
	return s.GetDispatch(ctx, dispatchID)
}

// PinCapability stores an active capability pin (hash only).
func (s *Store) PinCapability(ctx context.Context, pinID string, contractVersion int, featuresJSON, hash string, now time.Time) error {
	if pinID == "" || hash == "" || featuresJSON == "" || contractVersion < 1 {
		return errors.New("complete capability pin is required")
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}
	stamp := now.UTC().Format(tsLayout)
	_, err := s.db.ExecContext(ctx, `INSERT INTO orca_capability_pins(
		pin_id, contract_version, features_json, capability_hash, status, created_at, revoked_at
	) VALUES (?, ?, ?, ?, 'active', ?, NULL)
	ON CONFLICT(pin_id) DO UPDATE SET
		contract_version = excluded.contract_version,
		features_json = excluded.features_json,
		capability_hash = excluded.capability_hash,
		status = 'active',
		revoked_at = NULL`,
		pinID, contractVersion, featuresJSON, hash, stamp)
	return err
}

// RevokeCapability marks a pin revoked.
func (s *Store) RevokeCapability(ctx context.Context, pinID string, now time.Time) error {
	if now.IsZero() {
		now = time.Now().UTC()
	}
	stamp := now.UTC().Format(tsLayout)
	res, err := s.db.ExecContext(ctx,
		`UPDATE orca_capability_pins SET status = 'revoked', revoked_at = ? WHERE pin_id = ? AND status = 'active'`,
		stamp, pinID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("capability pin %s not active", pinID)
	}
	return nil
}

// IsCapabilityActive reports whether the hash belongs to an active pin.
func (s *Store) IsCapabilityActive(ctx context.Context, hash string) (bool, error) {
	var status string
	err := s.db.QueryRowContext(ctx,
		`SELECT status FROM orca_capability_pins WHERE capability_hash = ? ORDER BY created_at DESC LIMIT 1`,
		hash).Scan(&status)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return status == "active", nil
}

func (s *Store) updateDispatch(ctx context.Context, d Dispatch) error {
	stamp := d.UpdatedAt.UTC().Format(tsLayout)
	_, err := s.db.ExecContext(ctx, `UPDATE orca_dispatches SET
		terminal_handle = ?, capability_hash = ?, process_incarnation = ?, status = ?,
		output_cursor = ?, reattach_count = ?, updated_at = ?
		WHERE dispatch_id = ?`,
		d.TerminalHandle, nullString(d.CapabilityHash), d.ProcessIncarnation, d.Status,
		d.OutputCursor, d.ReattachCount, stamp, d.DispatchID)
	if err != nil {
		return fmt.Errorf("update dispatch: %w", err)
	}
	return nil
}

func (s *Store) upsertCursor(ctx context.Context, terminal, dispatchID string, cursor int64, stamp string) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO orca_terminal_cursors(terminal_handle, dispatch_id, output_cursor, updated_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(terminal_handle) DO UPDATE SET
			dispatch_id = excluded.dispatch_id,
			output_cursor = excluded.output_cursor,
			updated_at = excluded.updated_at`,
		terminal, dispatchID, cursor, stamp)
	if err != nil {
		return fmt.Errorf("upsert terminal cursor: %w", err)
	}
	return nil
}

type scannable interface {
	Scan(dest ...any) error
}

func scanDispatch(row scannable) (Dispatch, error) {
	var d Dispatch
	var created, updated string
	var completed sql.NullString
	err := row.Scan(
		&d.DispatchID, &d.RunID, &d.TaskID, &d.TerminalHandle, &d.CapabilityHash,
		&d.ProcessIncarnation, &d.Status, &d.OutputCursor, &d.ReattachCount,
		&d.QuarantineReason, &created, &updated, &completed,
	)
	if err != nil {
		return Dispatch{}, err
	}
	d.CreatedAt, err = time.Parse(tsLayout, created)
	if err != nil {
		return Dispatch{}, err
	}
	d.UpdatedAt, err = time.Parse(tsLayout, updated)
	if err != nil {
		return Dispatch{}, err
	}
	if completed.Valid {
		t, err := time.Parse(tsLayout, completed.String)
		if err != nil {
			return Dispatch{}, err
		}
		d.CompletedAt = &t
	}
	return d, nil
}

func nullString(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "UNIQUE") || strings.Contains(msg, "unique") || strings.Contains(msg, "constraint failed")
}
