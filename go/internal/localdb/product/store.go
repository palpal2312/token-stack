package product

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

const timestampLayout = "2006-01-02T15:04:05.000Z"

var validRoles = map[string]bool{"user": true, "assistant": true, "system": true}
var terminalCandidateStatuses = map[string]bool{"exported": true, "failed": true, "quarantined": true}

// Message is normalized current conversation state.
type Message struct {
	ID, SessionID, Role, Content string
	Metadata                     []byte
	CreatedAt                    time.Time
}

// CommandReceipt is append-only command audit keyed by command ID.
type CommandReceipt struct {
	CommandID, CommandType, ActorID, Status string
	Payload, Result                         []byte
	Error                                   *string
	ExecutedAt                              time.Time
}

// ExportCandidate is durable local outbox state.
type ExportCandidate struct {
	ID, SourceType, SourceID, ExportFormat, ContentHash, Status string
	CreatedAt                                                   time.Time
	ExportedAt                                                  *time.Time
}

func utcTimestamp(t time.Time) (string, error) {
	if t.IsZero() {
		return "", errors.New("timestamp is required")
	}
	return t.UTC().Format(timestampLayout), nil
}

// PutMessage inserts current state idempotently by ID.
func PutMessage(ctx context.Context, db *sql.DB, message Message) error {
	if db == nil {
		return errors.New("database connection is required")
	}
	if message.ID == "" || message.SessionID == "" || !validRoles[message.Role] {
		return errors.New("valid message id, session id, and role are required")
	}
	createdAt, err := utcTimestamp(message.CreatedAt)
	if err != nil {
		return err
	}
	_, err = db.ExecContext(ctx, `INSERT INTO sen_messages(id, session_id, role, content, metadata, created_at)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO NOTHING`, message.ID, message.SessionID, message.Role, message.Content, nullableBytes(message.Metadata), createdAt)
	return err
}

// PutCommandReceipt appends one immutable receipt; identical retries succeed.
func PutCommandReceipt(ctx context.Context, db *sql.DB, receipt CommandReceipt) error {
	if db == nil {
		return errors.New("database connection is required")
	}
	if receipt.CommandID == "" || receipt.CommandType == "" || receipt.ActorID == "" || receipt.Status == "" {
		return errors.New("command id, type, actor, and status are required")
	}
	executedAt, err := utcTimestamp(receipt.ExecutedAt)
	if err != nil {
		return err
	}
	result, err := db.ExecContext(ctx, `INSERT INTO command_receipts
		(command_id, command_type, actor_id, status, payload, result, error, executed_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(command_id) DO NOTHING`,
		receipt.CommandID, receipt.CommandType, receipt.ActorID, receipt.Status,
		nullableBytes(receipt.Payload), nullableBytes(receipt.Result), receipt.Error, executedAt)
	if err != nil {
		return err
	}
	inserted, err := result.RowsAffected()
	if err != nil || inserted == 1 {
		return err
	}
	var existing CommandReceipt
	var payload, output []byte
	var message sql.NullString
	var timestamp string
	err = db.QueryRowContext(ctx, `SELECT command_id, command_type, actor_id, status, payload, result, error, executed_at
		FROM command_receipts WHERE command_id = ?`, receipt.CommandID).Scan(
		&existing.CommandID, &existing.CommandType, &existing.ActorID, &existing.Status, &payload, &output, &message, &timestamp)
	if err != nil {
		return err
	}
	if existing.CommandType != receipt.CommandType || existing.ActorID != receipt.ActorID || existing.Status != receipt.Status ||
		string(payload) != string(receipt.Payload) || string(output) != string(receipt.Result) || !sameNullableString(message, receipt.Error) || timestamp != executedAt {
		return fmt.Errorf("command receipt %q conflicts with existing receipt", receipt.CommandID)
	}
	return nil
}

// PutExportCandidate appends one immutable outbox candidate; identical retries succeed.
func PutExportCandidate(ctx context.Context, db *sql.DB, candidate ExportCandidate) error {
	if db == nil {
		return errors.New("database connection is required")
	}
	if candidate.ID == "" || candidate.SourceType == "" || candidate.SourceID == "" || candidate.ExportFormat == "" || candidate.ContentHash == "" || candidate.Status != "pending" {
		return errors.New("complete pending export candidate is required")
	}
	if candidate.ExportedAt != nil {
		return errors.New("pending export candidate must not set exported_at")
	}
	createdAt, err := utcTimestamp(candidate.CreatedAt)
	if err != nil {
		return err
	}
	var exportedAt any
	result, err := db.ExecContext(ctx, `INSERT INTO export_candidates
		(id, source_type, source_id, export_format, content_hash, status, created_at, exported_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`, candidate.ID, candidate.SourceType,
		candidate.SourceID, candidate.ExportFormat, candidate.ContentHash, candidate.Status, createdAt, exportedAt)
	if err != nil {
		return err
	}
	inserted, err := result.RowsAffected()
	if err != nil || inserted == 1 {
		return err
	}
	var sourceType, sourceID, format, hash, status, storedCreated string
	var storedExported sql.NullString
	err = db.QueryRowContext(ctx, `SELECT source_type, source_id, export_format, content_hash, status, created_at, exported_at
		FROM export_candidates WHERE id = ?`, candidate.ID).Scan(&sourceType, &sourceID, &format, &hash, &status, &storedCreated, &storedExported)
	if err != nil {
		return err
	}
	if sourceType != candidate.SourceType || sourceID != candidate.SourceID || format != candidate.ExportFormat || hash != candidate.ContentHash ||
		status != candidate.Status || storedCreated != createdAt || !sameNullableTimestamp(storedExported, exportedAt) {
		return fmt.Errorf("export candidate %q conflicts with existing candidate", candidate.ID)
	}
	return nil
}

// ExportAcknowledgement identifies one outbox row and its terminal outcome.
type ExportAcknowledgement struct {
	ID, SourceType, SourceID, ExportFormat, ContentHash, Status string
	ExportedAt                                                  *time.Time
}

// AcknowledgeExportCandidate moves one pending outbox row to a terminal state.
// Exact terminal retries succeed; conflicting retries fail without mutation.
func AcknowledgeExportCandidate(ctx context.Context, db *sql.DB, acknowledgement ExportAcknowledgement) error {
	if db == nil {
		return errors.New("database connection is required")
	}
	if acknowledgement.ID == "" || acknowledgement.SourceType == "" || acknowledgement.SourceID == "" ||
		acknowledgement.ExportFormat == "" || acknowledgement.ContentHash == "" || !terminalCandidateStatuses[acknowledgement.Status] {
		return errors.New("complete export candidate acknowledgement with terminal status is required")
	}
	var exportedAt any
	switch acknowledgement.Status {
	case "exported":
		if acknowledgement.ExportedAt == nil {
			return errors.New("exported acknowledgement requires exported_at")
		}
		formatted, err := utcTimestamp(*acknowledgement.ExportedAt)
		if err != nil {
			return err
		}
		exportedAt = formatted
	default:
		if acknowledgement.ExportedAt != nil {
			return fmt.Errorf("%s acknowledgement must not set exported_at", acknowledgement.Status)
		}
	}

	result, err := db.ExecContext(ctx, `UPDATE export_candidates SET status = ?, exported_at = ?
		WHERE id = ? AND source_type = ? AND source_id = ? AND export_format = ? AND content_hash = ? AND status = 'pending'`,
		acknowledgement.Status, exportedAt, acknowledgement.ID, acknowledgement.SourceType,
		acknowledgement.SourceID, acknowledgement.ExportFormat, acknowledgement.ContentHash)
	if err != nil {
		return err
	}
	updated, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if updated == 1 {
		return nil
	}

	var sourceType, sourceID, format, hash, status string
	var storedExported sql.NullString
	err = db.QueryRowContext(ctx, `SELECT source_type, source_id, export_format, content_hash, status, exported_at
		FROM export_candidates WHERE id = ?`, acknowledgement.ID).Scan(
		&sourceType, &sourceID, &format, &hash, &status, &storedExported)
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("export candidate %q not found", acknowledgement.ID)
	}
	if err != nil {
		return err
	}
	if sourceType != acknowledgement.SourceType || sourceID != acknowledgement.SourceID ||
		format != acknowledgement.ExportFormat || hash != acknowledgement.ContentHash {
		return fmt.Errorf("export candidate %q identity or content conflicts with existing candidate", acknowledgement.ID)
	}
	if status != acknowledgement.Status || !sameNullableTimestamp(storedExported, exportedAt) {
		return fmt.Errorf("export candidate %q acknowledgement conflicts with existing status", acknowledgement.ID)
	}
	return nil
}

// ListPendingExportCandidates replays pending outbox rows in stable order.
func ListPendingExportCandidates(ctx context.Context, db *sql.DB, limit int) ([]ExportCandidate, error) {
	if limit <= 0 {
		return nil, errors.New("positive limit is required")
	}
	rows, err := db.QueryContext(ctx, `SELECT id, source_type, source_id, export_format, content_hash, status, created_at
		FROM export_candidates WHERE status = 'pending' ORDER BY created_at, id LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var candidates []ExportCandidate
	for rows.Next() {
		var candidate ExportCandidate
		var createdAt string
		if err := rows.Scan(&candidate.ID, &candidate.SourceType, &candidate.SourceID, &candidate.ExportFormat, &candidate.ContentHash, &candidate.Status, &createdAt); err != nil {
			return nil, err
		}
		candidate.CreatedAt, err = time.Parse(timestampLayout, createdAt)
		if err != nil {
			return nil, fmt.Errorf("parse candidate timestamp: %w", err)
		}
		candidates = append(candidates, candidate)
	}
	return candidates, rows.Err()
}

// CleanupExportCandidates removes only terminal rows older than cutoff.
func CleanupExportCandidates(ctx context.Context, db *sql.DB, cutoff time.Time, limit int) (int64, error) {
	if cutoff.IsZero() || limit <= 0 {
		return 0, errors.New("cutoff and positive limit are required")
	}
	result, err := db.ExecContext(ctx, `DELETE FROM export_candidates WHERE id IN (
		SELECT id FROM export_candidates
		WHERE status IN ('exported', 'failed', 'quarantined') AND created_at < ?
		ORDER BY created_at, id LIMIT ?
	)`, cutoff.UTC().Format(timestampLayout), limit)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

func nullableBytes(value []byte) any {
	if value == nil {
		return nil
	}
	return value
}

func sameNullableString(stored sql.NullString, expected *string) bool {
	if expected == nil {
		return !stored.Valid
	}
	return stored.Valid && stored.String == *expected
}

func sameNullableTimestamp(stored sql.NullString, expected any) bool {
	if expected == nil {
		return !stored.Valid
	}
	value, ok := expected.(string)
	return ok && stored.Valid && stored.String == value
}
