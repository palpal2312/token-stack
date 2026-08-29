package community

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

// SQLiteCommunityStore provides a robust, SQLite-backed store for frozen AO-15 contract tables.
type SQLiteCommunityStore struct {
	mu sync.RWMutex
	db *sql.DB
}

// OpenSQLiteCommunityStore opens/creates community-queue.db, sets PRAGMAs, and runs checksummed migrations.
func OpenSQLiteCommunityStore(ctx context.Context, dbPath string) (*SQLiteCommunityStore, error) {
	if dbPath == "" {
		return nil, errors.New("dbPath cannot be empty")
	}

	if dir := filepath.Dir(dbPath); dir != "." && dir != "" {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return nil, fmt.Errorf("failed to create db directory: %w", err)
		}
	}

	dsn := fmt.Sprintf("%s?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=synchronous(FULL)&_pragma=foreign_keys(ON)", dbPath)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("failed to open sqlite db: %w", err)
	}

	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	// Explicitly verify and enforce PRAGMAs
	if _, err := db.ExecContext(ctx, "PRAGMA journal_mode = WAL;"); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("failed to set WAL pragma: %w", err)
	}
	if _, err := db.ExecContext(ctx, "PRAGMA synchronous = FULL;"); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("failed to set synchronous pragma: %w", err)
	}
	if _, err := db.ExecContext(ctx, "PRAGMA foreign_keys = ON;"); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("failed to set foreign_keys pragma: %w", err)
	}
	if _, err := db.ExecContext(ctx, "PRAGMA busy_timeout = 5000;"); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("failed to set busy_timeout pragma: %w", err)
	}

	// Run checksummed forward migrations
	if err := RunMigrations(ctx, db); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("schema migration failed: %w", err)
	}

	return &SQLiteCommunityStore{db: db}, nil
}

// Close closes the underlying database connection.
func (s *SQLiteCommunityStore) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db != nil {
		return s.db.Close()
	}
	return nil
}

// DB returns the underlying sql.DB.
func (s *SQLiteCommunityStore) DB() *sql.DB {
	return s.db
}

func formatTimestamp(t time.Time) string {
	if t.IsZero() {
		return time.Now().UTC().Format(time.RFC3339Nano)
	}
	return t.UTC().Format(time.RFC3339Nano)
}

func parseTimestamp(s string) (time.Time, error) {
	if s == "" {
		return time.Time{}, nil
	}
	t, err := time.Parse(time.RFC3339Nano, s)
	if err == nil {
		return t.UTC(), nil
	}
	t, err = time.Parse(time.RFC3339, s)
	if err == nil {
		return t.UTC(), nil
	}
	t, err = time.Parse("2006-01-02 15:04:05", s)
	if err == nil {
		return t.UTC(), nil
	}
	return time.Time{}, err
}

// Enqueue inserts a new contribution into sanitized_contributions (AO-15).
func (s *SQLiteCommunityStore) Enqueue(ctx context.Context, item SanitizedContribution) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if err := ValidateItemSanity(&item); err != nil {
		return fmt.Errorf("item validation failed: %w", err)
	}

	if item.Source == "" {
		item.Source = "sen-product.db"
	}
	if item.Status == "" {
		if item.State != "" {
			item.Status = item.State
		} else {
			item.Status = StatusPending
		}
	}

	now := time.Now().UTC()
	if item.CreatedAt.IsZero() {
		item.CreatedAt = now
	}

	// Calculate payload_hash if missing
	if item.PayloadHash == "" {
		if item.RawPayload != "" {
			h := sha256.Sum256([]byte(item.RawPayload))
			item.PayloadHash = hex.EncodeToString(h[:])
		} else {
			metaBytes, _ := json.Marshal(item.Metadata)
			syntheticPayload := fmt.Sprintf("%s:%s:%s:%s:%s", item.ID, item.Title, item.AuthorRef, item.PluginSlug, string(metaBytes))
			h := sha256.Sum256([]byte(syntheticPayload))
			item.PayloadHash = hex.EncodeToString(h[:])
		}
	}

	// Ensure raw_payload is valid JSON
	if item.RawPayload == "" {
		metaBytes, _ := json.Marshal(item.Metadata)
		rawObj := map[string]interface{}{
			"id":          item.ID,
			"title":       item.Title,
			"author_ref":  item.AuthorRef,
			"plugin_slug": item.PluginSlug,
			"version":     item.Version,
			"metadata":    json.RawMessage(metaBytes),
		}
		rawBytes, _ := json.Marshal(rawObj)
		item.RawPayload = string(rawBytes)
	}

	var sanitizedJSON sql.NullString
	if item.SanitizedPayload != nil {
		sanitizedJSON = sql.NullString{String: *item.SanitizedPayload, Valid: true}
	} else if len(item.Metadata) > 0 {
		cleanMeta, _ := ValidateAndSanitizeMetadata(item.Metadata)
		metaBytes, _ := json.Marshal(cleanMeta)
		sanitizedJSON = sql.NullString{String: string(metaBytes), Valid: true}
	}

	var qReason sql.NullString
	if item.QuarantineReason != nil {
		qReason = sql.NullString{String: *item.QuarantineReason, Valid: true}
	} else if item.QuarantineRef != nil && item.QuarantineRef.Reason != "" {
		qReason = sql.NullString{String: item.QuarantineRef.Reason, Valid: true}
	}

	var processedAtStr sql.NullString
	if item.ProcessedAt != nil && !item.ProcessedAt.IsZero() {
		processedAtStr = sql.NullString{String: formatTimestamp(*item.ProcessedAt), Valid: true}
	}

	createdAtStr := formatTimestamp(item.CreatedAt)

	_, err := s.db.ExecContext(ctx, `
		INSERT INTO sanitized_contributions (
			id, source, payload_hash, raw_payload, sanitized_payload,
			status, quarantine_reason, created_at, processed_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, item.ID, item.Source, item.PayloadHash, item.RawPayload, sanitizedJSON,
		string(item.Status), qReason, createdAtStr, processedAtStr)

	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return fmt.Errorf("duplicate item id or payload hash: %w", err)
		}
		return fmt.Errorf("failed to enqueue contribution: %w", err)
	}
	return nil
}

// IngestExportCandidate safely ingests an AO-14 ProductExportCandidate into the queue.
// Invariants:
// - No plugin_slug or author_ref requirement.
// - Idempotent replay: if already exists with same ID or content hash, return existing.
// - Sanitizes raw payload and metadata; quarantines on validation failure without blocking queue.
func (s *SQLiteCommunityStore) IngestExportCandidate(ctx context.Context, candidate ProductExportCandidate) (*SanitizedContribution, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if candidate.ID == "" {
		return nil, errors.New("candidate ID cannot be empty")
	}

	// 1. Idempotent check by ID
	existing, err := s.getUnsafe(ctx, candidate.ID)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return existing, nil
	}

	// 2. Idempotent check by payload_hash
	payloadHash := candidate.ContentHash
	if payloadHash == "" {
		if candidate.RawPayload != "" {
			h := sha256.Sum256([]byte(candidate.RawPayload))
			payloadHash = hex.EncodeToString(h[:])
		} else {
			payloadHash = fmt.Sprintf("hash-%s", candidate.ID)
		}
	}

	var existingID string
	err = s.db.QueryRowContext(ctx, "SELECT id FROM sanitized_contributions WHERE payload_hash = ?", payloadHash).Scan(&existingID)
	if err == nil && existingID != "" {
		return s.getUnsafe(ctx, existingID)
	} else if err != nil && err != sql.ErrNoRows {
		return nil, fmt.Errorf("failed to check existing payload hash: %w", err)
	}

	now := time.Now().UTC()
	createdAt := candidate.CreatedAt
	if createdAt.IsZero() {
		createdAt = now
	}
	createdAtStr := formatTimestamp(createdAt)

	source := candidate.SourceType
	if source == "" {
		source = "sen-product.db"
	}

	// Validate raw payload and metadata for secrets / allowlist
	rawErr := ValidateRawPayload(candidate.RawPayload)
	cleanMeta, metaErr := ValidateAndSanitizeMetadata(candidate.Metadata)

	var (
		status         = StatusPending
		sanitizedJSON  sql.NullString
		qReason        sql.NullString
		processedAtStr sql.NullString
	)

	if rawErr != nil || metaErr != nil {
		status = StatusQuarantined
		reason := "sanitization validation failure"
		if rawErr != nil {
			reason = fmt.Sprintf("[ERR_RAW_SECRET] %s", rawErr.Error())
		} else if metaErr != nil {
			reason = fmt.Sprintf("[ERR_DISALLOWED_META] %s", metaErr.Error())
		}
		qReason = sql.NullString{String: reason, Valid: true}
		processedAtStr = sql.NullString{String: formatTimestamp(now), Valid: true}
	} else if len(cleanMeta) > 0 {
		metaBytes, _ := json.Marshal(cleanMeta)
		sanitizedJSON = sql.NullString{String: string(metaBytes), Valid: true}
	}

	rawPayload := candidate.RawPayload
	if rawPayload == "" {
		metaBytes, _ := json.Marshal(candidate.Metadata)
		rawObj := map[string]interface{}{
			"id":            candidate.ID,
			"source_type":   candidate.SourceType,
			"source_id":     candidate.SourceID,
			"export_format": candidate.ExportFormat,
			"content_hash":  candidate.ContentHash,
			"status":        candidate.Status,
			"metadata":      json.RawMessage(metaBytes),
		}
		rawBytes, _ := json.Marshal(rawObj)
		rawPayload = string(rawBytes)
	}

	_, err = s.db.ExecContext(ctx, `
		INSERT INTO sanitized_contributions (
			id, source, payload_hash, raw_payload, sanitized_payload,
			status, quarantine_reason, created_at, processed_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, candidate.ID, source, payloadHash, rawPayload, sanitizedJSON,
		string(status), qReason, createdAtStr, processedAtStr)

	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			// Race condition duplicate insert: return existing
			return s.getUnsafe(ctx, candidate.ID)
		}
		return nil, fmt.Errorf("failed to ingest candidate: %w", err)
	}

	return s.getUnsafe(ctx, candidate.ID)
}

// Get retrieves a contribution by ID.
func (s *SQLiteCommunityStore) Get(ctx context.Context, id string) (*SanitizedContribution, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return s.getUnsafe(ctx, id)
}

// ListPending returns all contributions currently pending or sanitizing.
func (s *SQLiteCommunityStore) ListPending(ctx context.Context) ([]SanitizedContribution, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	rows, err := s.db.QueryContext(ctx, `
		SELECT id, source, payload_hash, raw_payload, sanitized_payload,
		       status, quarantine_reason, created_at, processed_at
		FROM sanitized_contributions
		WHERE status IN ('pending', 'sanitizing')
		ORDER BY created_at ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("failed to query pending contributions: %w", err)
	}
	defer rows.Close()

	var pending []SanitizedContribution
	for rows.Next() {
		var (
			item          SanitizedContribution
			sanitizedJSON sql.NullString
			qReason       sql.NullString
			createdStr    string
			processedStr  sql.NullString
			rawStatus     string
		)
		if err := rows.Scan(
			&item.ID, &item.Source, &item.PayloadHash, &item.RawPayload, &sanitizedJSON,
			&rawStatus, &qReason, &createdStr, &processedStr,
		); err != nil {
			return nil, fmt.Errorf("failed to scan item: %w", err)
		}
		item.Status = ContributionStatus(rawStatus)
		item.State = item.Status
		if sanitizedJSON.Valid {
			item.SanitizedPayload = &sanitizedJSON.String
			_ = json.Unmarshal([]byte(sanitizedJSON.String), &item.Metadata)
		}
		if qReason.Valid {
			item.QuarantineReason = &qReason.String
			item.QuarantineRef = &QuarantineRef{Reason: qReason.String}
		}
		item.CreatedAt, _ = parseTimestamp(createdStr)
		if processedStr.Valid {
			t, _ := parseTimestamp(processedStr.String)
			item.ProcessedAt = &t
			item.UpdatedAt = t
		}
		// Hydrate raw fields if JSON is structured
		var rawMap map[string]interface{}
		if err := json.Unmarshal([]byte(item.RawPayload), &rawMap); err == nil {
			if title, ok := rawMap["title"].(string); ok {
				item.Title = title
			}
			if author, ok := rawMap["author_ref"].(string); ok {
				item.AuthorRef = author
			}
			if slug, ok := rawMap["plugin_slug"].(string); ok {
				item.PluginSlug = slug
			}
			if ver, ok := rawMap["version"].(string); ok {
				item.Version = ver
			}
		}
		pending = append(pending, item)
	}
	return pending, rows.Err()
}

// Transition advances status machine safely.
func (s *SQLiteCommunityStore) Transition(ctx context.Context, id string, nextStatus ContributionStatus) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	item, err := s.getUnsafe(ctx, id)
	if err != nil {
		return err
	}
	if item == nil {
		return fmt.Errorf("contribution %q not found", id)
	}

	allowed := ValidTransitions[item.Status]
	valid := false
	for _, st := range allowed {
		if st == nextStatus {
			valid = true
			break
		}
	}
	if !valid {
		return fmt.Errorf("invalid transition %q -> %q for contribution %s", item.Status, nextStatus, id)
	}

	now := time.Now().UTC()
	nowStr := formatTimestamp(now)
	_, err = s.db.ExecContext(ctx, `
		UPDATE sanitized_contributions SET status = ?, processed_at = ? WHERE id = ?
	`, string(nextStatus), nowStr, id)
	if err != nil {
		return fmt.Errorf("failed to transition status: %w", err)
	}
	return nil
}

// Quarantine flags a violating contribution and isolates it without blocking the rest of the queue.
func (s *SQLiteCommunityStore) Quarantine(ctx context.Context, id string, reason, violationCode string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	item, err := s.getUnsafe(ctx, id)
	if err != nil {
		return err
	}
	if item == nil {
		return fmt.Errorf("contribution %q not found", id)
	}

	if item.Status == StatusRejected {
		return fmt.Errorf("cannot quarantine terminal rejected contribution %q", id)
	}

	fullReason := reason
	if violationCode != "" {
		fullReason = fmt.Sprintf("[%s] %s", violationCode, reason)
	}

	// Idempotent retry when already quarantined
	if item.Status == StatusQuarantined {
		if (item.QuarantineReason != nil && *item.QuarantineReason == fullReason) ||
			(item.QuarantineReason != nil && *item.QuarantineReason == reason) {
			return nil
		}
		currReason := ""
		if item.QuarantineReason != nil {
			currReason = *item.QuarantineReason
		}
		return fmt.Errorf("contribution %q already quarantined with incompatible reason %q", id, currReason)
	}

	allowed := ValidTransitions[item.Status]
	valid := false
	for _, st := range allowed {
		if st == StatusQuarantined {
			valid = true
			break
		}
	}
	if !valid {
		return fmt.Errorf("invalid transition %q -> %q for contribution %s", item.Status, StatusQuarantined, id)
	}

	now := time.Now().UTC()
	nowStr := formatTimestamp(now)

	res, err := s.db.ExecContext(ctx, `
		UPDATE sanitized_contributions
		SET status = 'quarantined',
		    quarantine_reason = ?,
		    processed_at = ?
		WHERE id = ?
	`, fullReason, nowStr, id)
	if err != nil {
		return fmt.Errorf("failed to quarantine contribution: %w", err)
	}
	rowsAffected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return fmt.Errorf("contribution %q not found", id)
	}
	return nil
}

// Export creates the export envelope and marks status as sanitized.
func (s *SQLiteCommunityStore) Export(ctx context.Context, id string) (*ExportEnvelope, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	item, err := s.getUnsafe(ctx, id)
	if err != nil {
		return nil, err
	}
	if item == nil {
		return nil, fmt.Errorf("contribution %q not found", id)
	}

	if item.Status != StatusPending && item.Status != StatusSanitizing && item.Status != StatusSanitized {
		return nil, fmt.Errorf("item %s must be in pending, sanitizing, or sanitized status to export (current: %s)", id, item.Status)
	}

	envelope, err := BuildExportEnvelope(item)
	if err != nil {
		return nil, err
	}

	now := time.Now().UTC()
	nowStr := formatTimestamp(now)
	cleanMeta, _ := ValidateAndSanitizeMetadata(item.Metadata)
	metaBytes, _ := json.Marshal(cleanMeta)

	_, err = s.db.ExecContext(ctx, `
		UPDATE sanitized_contributions SET status = 'sanitized', sanitized_payload = ?, processed_at = ? WHERE id = ?
	`, string(metaBytes), nowStr, id)
	if err != nil {
		return nil, fmt.Errorf("failed to set status to sanitized: %w", err)
	}

	return envelope, nil
}

// RecordDeliveryAttempt logs an at-least-once delivery attempt for a contribution (AO-15).
func (s *SQLiteCommunityStore) RecordDeliveryAttempt(ctx context.Context, attempt DeliveryAttempt) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if attempt.ID == "" {
		return errors.New("delivery attempt id is required")
	}
	if attempt.ContributionID == "" {
		return errors.New("contribution_id is required")
	}
	if attempt.TargetDestination == "" {
		if attempt.TargetEndpoint != "" {
			attempt.TargetDestination = attempt.TargetEndpoint
		} else {
			attempt.TargetDestination = "community-sink"
		}
	}
	if attempt.AttemptNumber == 0 {
		attempt.AttemptNumber = 1
	}
	if attempt.Status == "" {
		attempt.Status = DeliveryEnqueued
	}
	now := time.Now().UTC()
	if attempt.CreatedAt.IsZero() {
		if !attempt.AttemptedAt.IsZero() {
			attempt.CreatedAt = attempt.AttemptedAt
		} else {
			attempt.CreatedAt = now
		}
	}
	createdAtStr := formatTimestamp(attempt.CreatedAt)

	var (
		errStr      sql.NullString
		completedAt sql.NullString
	)
	if attempt.Error != nil {
		errStr = sql.NullString{String: *attempt.Error, Valid: true}
	} else if attempt.ErrorMessage != "" {
		errStr = sql.NullString{String: attempt.ErrorMessage, Valid: true}
	}
	if attempt.CompletedAt != nil && !attempt.CompletedAt.IsZero() {
		completedAt = sql.NullString{String: formatTimestamp(*attempt.CompletedAt), Valid: true}
	} else if attempt.Status == DeliverySucceeded || attempt.Status == DeliveryFailed {
		completedAt = sql.NullString{String: createdAtStr, Valid: true}
	}

	_, err := s.db.ExecContext(ctx, `
		INSERT INTO delivery_attempts (id, contribution_id, target_destination, attempt_number, status, error, created_at, completed_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, attempt.ID, attempt.ContributionID, attempt.TargetDestination, attempt.AttemptNumber, string(attempt.Status), errStr, createdAtStr, completedAt)
	if err != nil {
		return fmt.Errorf("failed to record delivery attempt: %w", err)
	}
	return nil
}

// RecordPublicationReceipt stores immutable publication receipt and updates status to sanitized (AO-15).
func (s *SQLiteCommunityStore) RecordPublicationReceipt(ctx context.Context, receipt PublicationReceipt) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if receipt.ID == "" || receipt.ContributionID == "" {
		return errors.New("receipt id and contribution_id are required")
	}
	if receipt.PublishedTo == "" {
		if receipt.DeliveryID != "" {
			receipt.PublishedTo = receipt.DeliveryID
		} else {
			receipt.PublishedTo = "community-registry"
		}
	}
	now := time.Now().UTC()
	if receipt.PublishedAt.IsZero() {
		receipt.PublishedAt = now
	}
	if receipt.ReceiptHash == "" {
		h := sha256.Sum256(fmt.Appendf(nil, "%s:%s:%s", receipt.ContributionID, receipt.PublishedTo, receipt.PublishedAt.Format(time.RFC3339)))
		receipt.ReceiptHash = hex.EncodeToString(h[:])
	}

	metaBytes, _ := json.Marshal(receipt.Metadata)
	publishedAtStr := formatTimestamp(receipt.PublishedAt)
	nowStr := formatTimestamp(now)

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	_, err = tx.ExecContext(ctx, `
		INSERT INTO publication_receipts (id, contribution_id, receipt_hash, published_to, metadata, published_at)
		VALUES (?, ?, ?, ?, ?, ?)
	`, receipt.ID, receipt.ContributionID, receipt.ReceiptHash, receipt.PublishedTo, string(metaBytes), publishedAtStr)
	if err != nil {
		return fmt.Errorf("failed to insert publication receipt: %w", err)
	}

	_, err = tx.ExecContext(ctx, `
		UPDATE sanitized_contributions SET status = 'sanitized', processed_at = ? WHERE id = ?
	`, nowStr, receipt.ContributionID)
	if err != nil {
		return fmt.Errorf("failed to update contribution to sanitized: %w", err)
	}

	return tx.Commit()
}

// RecordRemovalReport logs an audit, withdrawal, or policy removal report.
func (s *SQLiteCommunityStore) RecordRemovalReport(ctx context.Context, report RemovalReport) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if report.ID == "" {
		return errors.New("removal report id is required")
	}
	if report.ContributionID == "" {
		return errors.New("removal report contribution_id is required")
	}
	now := time.Now().UTC()
	if report.ReportedAt.IsZero() {
		report.ReportedAt = now
	}
	if report.Status == "" {
		report.Status = "pending"
	}
	reportedAtStr := formatTimestamp(report.ReportedAt)
	var processedAtStr sql.NullString
	if report.ProcessedAt != nil && !report.ProcessedAt.IsZero() {
		processedAtStr = sql.NullString{String: formatTimestamp(*report.ProcessedAt), Valid: true}
	}

	_, err := s.db.ExecContext(ctx, `
		INSERT INTO removal_reports (id, contribution_id, plugin_slug, reason, reporter_ref, status, reported_at, processed_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, report.ID, report.ContributionID, report.PluginSlug, report.Reason, report.ReporterRef, report.Status, reportedAtStr, processedAtStr)
	if err != nil {
		return fmt.Errorf("failed to record removal report: %w", err)
	}
	return nil
}

// Tombstone marks a contribution as rejected after verified removal processing (AO-15).
func (s *SQLiteCommunityStore) Tombstone(ctx context.Context, contributionID string, reason string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now().UTC()
	nowStr := formatTimestamp(now)
	res, err := s.db.ExecContext(ctx, `
		UPDATE sanitized_contributions
		SET status = 'rejected',
		    quarantine_reason = ?,
		    processed_at = ?
		WHERE id = ?
	`, reason, nowStr, contributionID)
	if err != nil {
		return fmt.Errorf("failed to tombstone contribution: %w", err)
	}
	rows, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return fmt.Errorf("contribution %q not found", contributionID)
	}
	return nil
}

// UpdateSyncWatermark persists stream sequence progression.
func (s *SQLiteCommunityStore) UpdateSyncWatermark(ctx context.Context, wm SyncWatermark) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if wm.StreamID == "" {
		return errors.New("stream_id is required")
	}
	now := time.Now().UTC()
	wm.UpdatedAt = now
	updatedAtStr := formatTimestamp(wm.UpdatedAt)

	_, err := s.db.ExecContext(ctx, `
		INSERT INTO sync_watermarks (stream_id, last_seq, last_checkpoint, updated_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(stream_id) DO UPDATE SET
			last_seq = excluded.last_seq,
			last_checkpoint = excluded.last_checkpoint,
			updated_at = excluded.updated_at
	`, wm.StreamID, wm.LastSeq, wm.LastCheckpoint, updatedAtStr)
	if err != nil {
		return fmt.Errorf("failed to update sync watermark: %w", err)
	}
	return nil
}

// GetSyncWatermark retrieves the current sync watermark for a stream.
func (s *SQLiteCommunityStore) GetSyncWatermark(ctx context.Context, streamID string) (*SyncWatermark, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	row := s.db.QueryRowContext(ctx, `
		SELECT stream_id, last_seq, last_checkpoint, updated_at
		FROM sync_watermarks WHERE stream_id = ?
	`, streamID)

	var (
		wm         SyncWatermark
		updatedStr string
	)
	err := row.Scan(&wm.StreamID, &wm.LastSeq, &wm.LastCheckpoint, &updatedStr)
	if err == sql.ErrNoRows {
		return &SyncWatermark{StreamID: streamID, LastSeq: 0, LastCheckpoint: ""}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get sync watermark: %w", err)
	}
	wm.UpdatedAt, _ = parseTimestamp(updatedStr)
	return &wm, nil
}

// getUnsafe reads contribution without locking.
func (s *SQLiteCommunityStore) getUnsafe(ctx context.Context, id string) (*SanitizedContribution, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, source, payload_hash, raw_payload, sanitized_payload,
		       status, quarantine_reason, created_at, processed_at
		FROM sanitized_contributions WHERE id = ?
	`, id)

	var (
		item          SanitizedContribution
		sanitizedJSON sql.NullString
		qReason       sql.NullString
		createdStr    string
		processedStr  sql.NullString
		rawStatus     string
	)

	err := row.Scan(
		&item.ID, &item.Source, &item.PayloadHash, &item.RawPayload, &sanitizedJSON,
		&rawStatus, &qReason, &createdStr, &processedStr,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to query contribution: %w", err)
	}

	item.Status = ContributionStatus(rawStatus)
	item.State = item.Status
	if sanitizedJSON.Valid {
		item.SanitizedPayload = &sanitizedJSON.String
		_ = json.Unmarshal([]byte(sanitizedJSON.String), &item.Metadata)
	}
	if qReason.Valid {
		item.QuarantineReason = &qReason.String
		item.QuarantineRef = &QuarantineRef{
			Reason: qReason.String,
		}
	}
	item.CreatedAt, _ = parseTimestamp(createdStr)
	if processedStr.Valid {
		t, _ := parseTimestamp(processedStr.String)
		item.ProcessedAt = &t
		item.UpdatedAt = t
	}

	// Parse structured metadata fields from raw_payload if present
	var rawMap map[string]interface{}
	if err := json.Unmarshal([]byte(item.RawPayload), &rawMap); err == nil {
		if title, ok := rawMap["title"].(string); ok {
			item.Title = title
		}
		if author, ok := rawMap["author_ref"].(string); ok {
			item.AuthorRef = author
		}
		if slug, ok := rawMap["plugin_slug"].(string); ok {
			item.PluginSlug = slug
		}
		if ver, ok := rawMap["version"].(string); ok {
			item.Version = ver
		}
		if meta, ok := rawMap["metadata"].(map[string]interface{}); ok && item.Metadata == nil {
			item.Metadata = make(map[string]string)
			for k, v := range meta {
				if sv, ok := v.(string); ok {
					item.Metadata[k] = sv
				}
			}
		}
	}

	return &item, nil
}
