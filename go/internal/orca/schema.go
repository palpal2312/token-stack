package orca

import "agentic-os/internal/localdb/core"

// schemaSQL must stay byte-identical to go/migrations/000004_orca_dispatch_cursors.sql
// after stripping that file's comment header.
const schemaSQL = `CREATE TABLE orca_dispatches (
	dispatch_id TEXT PRIMARY KEY,
	run_id TEXT NOT NULL,
	task_id TEXT NOT NULL,
	terminal_handle TEXT NOT NULL,
	capability_hash TEXT,
	process_incarnation TEXT NOT NULL DEFAULT '',
	status TEXT NOT NULL CHECK(status IN (
		'dispatched', 'running', 'succeeded', 'failed', 'quarantined', 'fenced'
	)),
	output_cursor INTEGER NOT NULL DEFAULT 0 CHECK(output_cursor >= 0),
	reattach_count INTEGER NOT NULL DEFAULT 0 CHECK(reattach_count >= 0),
	quarantine_reason TEXT,
	created_at TEXT NOT NULL CHECK(created_at GLOB '????-??-??T??:??:??.???Z'),
	updated_at TEXT NOT NULL CHECK(updated_at GLOB '????-??-??T??:??:??.???Z'),
	completed_at TEXT CHECK(completed_at IS NULL OR completed_at GLOB '????-??-??T??:??:??.???Z')
);
CREATE INDEX idx_orca_dispatches_task_status ON orca_dispatches(task_id, status);
CREATE UNIQUE INDEX idx_orca_dispatches_one_active
	ON orca_dispatches(task_id)
	WHERE status IN ('dispatched', 'running');
CREATE TABLE orca_terminal_cursors (
	terminal_handle TEXT PRIMARY KEY,
	dispatch_id TEXT REFERENCES orca_dispatches(dispatch_id) ON DELETE SET NULL,
	output_cursor INTEGER NOT NULL DEFAULT 0 CHECK(output_cursor >= 0),
	updated_at TEXT NOT NULL CHECK(updated_at GLOB '????-??-??T??:??:??.???Z')
);
CREATE TABLE orca_capability_pins (
	pin_id TEXT PRIMARY KEY,
	contract_version INTEGER NOT NULL CHECK(contract_version >= 1),
	features_json TEXT NOT NULL,
	capability_hash TEXT NOT NULL,
	status TEXT NOT NULL CHECK(status IN ('active', 'revoked')),
	created_at TEXT NOT NULL CHECK(created_at GLOB '????-??-??T??:??:??.???Z'),
	revoked_at TEXT CHECK(revoked_at IS NULL OR revoked_at GLOB '????-??-??T??:??:??.???Z')
);
CREATE TRIGGER orca_dispatches_terminal_immutable
BEFORE UPDATE OF status ON orca_dispatches
WHEN OLD.status IN ('succeeded', 'failed', 'quarantined', 'fenced')
	AND NEW.status != OLD.status
BEGIN
	SELECT RAISE(ABORT, 'orca dispatch terminal status is immutable');
END;`

var migrations = []core.Migration{
	{
		Version: 1,
		Name:    "ADP-05 orca dispatch cursors",
		SQL:     schemaSQL,
	},
}
