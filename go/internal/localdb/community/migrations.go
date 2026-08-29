package community

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
)

// MigrationsList contains the ordered, checksummed forward schema migrations for frozen AO-15 contract.
var MigrationsList = []Migration{
	{
		Version: 1,
		Name:    "0001_initial_meta_and_migrations",
		SQL: `
CREATE TABLE IF NOT EXISTS schema_migrations (
	version INTEGER PRIMARY KEY,
	name TEXT NOT NULL,
	checksum TEXT NOT NULL,
	applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS community_queue_meta (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL
);
`,
	},
	{
		Version: 2,
		Name:    "0002_sanitized_contributions",
		SQL: `
CREATE TABLE IF NOT EXISTS sanitized_contributions (
	id TEXT PRIMARY KEY,
	seq INTEGER NOT NULL UNIQUE,
	title TEXT NOT NULL,
	author_ref TEXT NOT NULL,
	plugin_slug TEXT NOT NULL,
	version TEXT NOT NULL,
	state TEXT NOT NULL CHECK(state IN ('draft', 'queued', 'sanitizing', 'approved', 'exporting', 'exported', 'delivered', 'tombstoned', 'quarantined')),
	metadata_json TEXT NOT NULL DEFAULT '{}',
	quarantine_reason TEXT,
	quarantine_code TEXT,
	quarantined_at TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sanitized_contrib_state ON sanitized_contributions(state);
CREATE INDEX IF NOT EXISTS idx_sanitized_contrib_seq ON sanitized_contributions(seq);
CREATE INDEX IF NOT EXISTS idx_sanitized_contrib_plugin ON sanitized_contributions(plugin_slug);
`,
	},
	{
		Version: 3,
		Name:    "0003_delivery_and_publications",
		SQL: `
CREATE TABLE IF NOT EXISTS delivery_attempts (
	id TEXT PRIMARY KEY,
	contribution_id TEXT NOT NULL,
	attempt_number INTEGER NOT NULL,
	target_endpoint TEXT NOT NULL,
	status TEXT NOT NULL CHECK(status IN ('pending', 'success', 'failed')),
	error_message TEXT,
	attempted_at TEXT NOT NULL,
	FOREIGN KEY(contribution_id) REFERENCES sanitized_contributions(id) ON DELETE CASCADE,
	UNIQUE(contribution_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS idx_delivery_attempts_contrib ON delivery_attempts(contribution_id);

CREATE TABLE IF NOT EXISTS publication_receipts (
	id TEXT PRIMARY KEY,
	contribution_id TEXT NOT NULL UNIQUE,
	delivery_id TEXT NOT NULL UNIQUE,
	receipt_hash TEXT NOT NULL,
	published_at TEXT NOT NULL,
	FOREIGN KEY(contribution_id) REFERENCES sanitized_contributions(id) ON DELETE CASCADE,
	FOREIGN KEY(delivery_id) REFERENCES delivery_attempts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_publication_receipts_contrib ON publication_receipts(contribution_id);
`,
	},
	{
		Version: 4,
		Name:    "0004_removal_reports_and_watermarks",
		SQL: `
CREATE TABLE IF NOT EXISTS removal_reports (
	id TEXT PRIMARY KEY,
	contribution_id TEXT NOT NULL,
	plugin_slug TEXT NOT NULL,
	reason TEXT NOT NULL,
	reporter_ref TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processed', 'dismissed')),
	reported_at TEXT NOT NULL,
	processed_at TEXT,
	FOREIGN KEY(contribution_id) REFERENCES sanitized_contributions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_removal_reports_status ON removal_reports(status);
CREATE INDEX IF NOT EXISTS idx_removal_reports_contrib ON removal_reports(contribution_id);

CREATE TABLE IF NOT EXISTS sync_watermarks (
	stream_id TEXT PRIMARY KEY,
	last_seq INTEGER NOT NULL DEFAULT 0,
	last_checkpoint TEXT NOT NULL DEFAULT '',
	updated_at TEXT NOT NULL
);
`,
	},
	{
		Version: 5,
		Name:    "0005_ao15_exact_schema_conformance",
		SQL: `
-- Recreate sanitized_contributions with exact AO-15 column names, types, CHECK vocabulary, and indexes
CREATE TABLE IF NOT EXISTS sanitized_contributions_v5 (
	id TEXT PRIMARY KEY,
	source TEXT NOT NULL DEFAULT 'sen-product.db',
	payload_hash TEXT NOT NULL UNIQUE,
	raw_payload JSON NOT NULL,
	sanitized_payload JSON,
	status TEXT NOT NULL CHECK(status IN ('pending', 'sanitizing', 'sanitized', 'quarantined', 'rejected')),
	quarantine_reason TEXT,
	created_at TEXT NOT NULL, -- RFC3339 UTC
	processed_at TEXT         -- RFC3339 UTC
);

-- Copy data from previous schema
INSERT OR IGNORE INTO sanitized_contributions_v5 (
	id, source, payload_hash, raw_payload, sanitized_payload, status, quarantine_reason, created_at, processed_at
)
SELECT
	id,
	'sen-product.db' AS source,
	CASE
		WHEN id IS NOT NULL AND id != '' THEN 'hash-' || id
		ELSE 'hash-legacy-' || seq
	END AS payload_hash,
	json_object('title', title, 'author_ref', author_ref, 'plugin_slug', plugin_slug, 'version', version, 'metadata', json(metadata_json)) AS raw_payload,
	json(metadata_json) AS sanitized_payload,
	CASE
		WHEN state IN ('draft', 'queued') THEN 'pending'
		WHEN state = 'sanitizing' THEN 'sanitizing'
		WHEN state IN ('approved', 'exporting', 'exported', 'delivered') THEN 'sanitized'
		WHEN state = 'quarantined' THEN 'quarantined'
		ELSE 'rejected'
	END AS status,
	quarantine_reason,
	created_at,
	updated_at AS processed_at
FROM sanitized_contributions;

DROP TABLE sanitized_contributions;
ALTER TABLE sanitized_contributions_v5 RENAME TO sanitized_contributions;

-- Create exact AO-15 indexes for sanitized_contributions
CREATE INDEX IF NOT EXISTS idx_contrib_hash ON sanitized_contributions(payload_hash);
CREATE INDEX IF NOT EXISTS idx_contrib_status ON sanitized_contributions(status);

-- Recreate delivery_attempts with exact AO-15 schema
CREATE TABLE IF NOT EXISTS delivery_attempts_v5 (
	id TEXT PRIMARY KEY,
	contribution_id TEXT NOT NULL REFERENCES sanitized_contributions(id) ON DELETE CASCADE,
	target_destination TEXT NOT NULL,
	attempt_number INTEGER NOT NULL DEFAULT 1,
	status TEXT NOT NULL CHECK(status IN ('enqueued', 'sending', 'succeeded', 'failed', 'quarantined')),
	error TEXT,
	created_at TEXT NOT NULL, -- RFC3339 UTC
	completed_at TEXT         -- RFC3339 UTC
);

INSERT OR IGNORE INTO delivery_attempts_v5 (
	id, contribution_id, target_destination, attempt_number, status, error, created_at, completed_at
)
SELECT
	id,
	contribution_id,
	target_endpoint AS target_destination,
	attempt_number,
	CASE
		WHEN status = 'pending' THEN 'enqueued'
		WHEN status = 'success' THEN 'succeeded'
		WHEN status = 'failed' THEN 'failed'
		ELSE 'enqueued'
	END AS status,
	error_message AS error,
	attempted_at AS created_at,
	attempted_at AS completed_at
FROM delivery_attempts;

DROP TABLE delivery_attempts;
ALTER TABLE delivery_attempts_v5 RENAME TO delivery_attempts;

-- Create exact AO-15 index for delivery_attempts
CREATE INDEX IF NOT EXISTS idx_delivery_status ON delivery_attempts(status);

-- Recreate publication_receipts with exact AO-15 schema
CREATE TABLE IF NOT EXISTS publication_receipts_v5 (
	id TEXT PRIMARY KEY,
	contribution_id TEXT NOT NULL REFERENCES sanitized_contributions(id) ON DELETE CASCADE,
	receipt_hash TEXT NOT NULL UNIQUE,
	published_to TEXT NOT NULL,
	metadata JSON,
	published_at TEXT NOT NULL -- RFC3339 UTC
);

INSERT OR IGNORE INTO publication_receipts_v5 (
	id, contribution_id, receipt_hash, published_to, metadata, published_at
)
SELECT
	id,
	contribution_id,
	receipt_hash,
	delivery_id AS published_to,
	json('{}') AS metadata,
	published_at
FROM publication_receipts;

DROP TABLE publication_receipts;
ALTER TABLE publication_receipts_v5 RENAME TO publication_receipts;
`,
	},
	{
		Version: 6,
		Name:    "0006_terminal_state_guard_triggers",
		SQL: `
CREATE TRIGGER IF NOT EXISTS trg_prevent_rejected_transition
BEFORE UPDATE OF status ON sanitized_contributions
FOR EACH ROW
WHEN OLD.status = 'rejected' AND NEW.status != 'rejected'
BEGIN
	SELECT RAISE(ABORT, 'cannot transition from terminal rejected status');
END;
`,
	},
}

func init() {
	for i := range MigrationsList {
		h := sha256.Sum256([]byte(MigrationsList[i].SQL))
		MigrationsList[i].Checksum = hex.EncodeToString(h[:])
	}
}

// ComputeChecksum calculates sha256 hex digest for SQL string.
func ComputeChecksum(sqlStr string) string {
	h := sha256.Sum256([]byte(sqlStr))
	return hex.EncodeToString(h[:])
}

// RunMigrations applies all forward migrations within a transaction, verifying checksums.
func RunMigrations(ctx context.Context, db *sql.DB) error {
	// First bootstrap migration table if needed
	_, err := db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version INTEGER PRIMARY KEY,
			name TEXT NOT NULL,
			checksum TEXT NOT NULL,
			applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
	`)
	if err != nil {
		return fmt.Errorf("failed to ensure schema_migrations table: %w", err)
	}

	for _, m := range MigrationsList {
		var existingChecksum string
		row := db.QueryRowContext(ctx, "SELECT checksum FROM schema_migrations WHERE version = ?", m.Version)
		err := row.Scan(&existingChecksum)

		if err == sql.ErrNoRows {
			// Apply new migration in transaction
			tx, err := db.BeginTx(ctx, nil)
			if err != nil {
				return fmt.Errorf("migration %d begin tx failed: %w", m.Version, err)
			}
			if _, err := tx.ExecContext(ctx, m.SQL); err != nil {
				_ = tx.Rollback()
				return fmt.Errorf("migration %d (%s) exec failed: %w", m.Version, m.Name, err)
			}
			if _, err := tx.ExecContext(ctx, "INSERT INTO schema_migrations (version, name, checksum) VALUES (?, ?, ?)", m.Version, m.Name, m.Checksum); err != nil {
				_ = tx.Rollback()
				return fmt.Errorf("migration %d recording failed: %w", m.Version, err)
			}
			if err := tx.Commit(); err != nil {
				return fmt.Errorf("migration %d commit failed: %w", m.Version, err)
			}
		} else if err != nil {
			return fmt.Errorf("checking migration %d status failed: %w", m.Version, err)
		} else {
			// Verify checksum drift
			if existingChecksum != m.Checksum {
				return fmt.Errorf("migration %d checksum mismatch: database has %s, code has %s (migration drift)", m.Version, existingChecksum, m.Checksum)
			}
		}
	}

	return nil
}
