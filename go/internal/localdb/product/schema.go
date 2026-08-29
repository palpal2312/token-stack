package product

import "agentic-os/internal/localdb/core"

// Sprint08Registration identifies immutable accepted Sprint 08 bytes without
// copying or redesigning producer-owned implementations.
type Sprint08Registration struct {
	ID           string
	Owner        string
	Artifact     string
	SHA256       string
	StorageClass string
}

// Sprint08Migrations is ordered by the frozen A, B, C registration protocol.
// A is an atomic-file schema marker; B and C are executable SQLite fragments.
var Sprint08Migrations = []Sprint08Registration{
	{
		ID:           "s08a_001",
		Owner:        "S08-A",
		Artifact:     "go/internal/admission/s08a_001_admission.go",
		SHA256:       "b034e3a9bc6759a85a2275275f47aa74aaef1f840595b2854d4b1f609ba4d93e",
		StorageClass: "atomic-file",
	},
	{
		ID:           "s08b_001",
		Owner:        "S08-B",
		Artifact:     "go/migrations/s08b_001-governed-memory.sql",
		SHA256:       "e5612221dce12711f7800fd721736b10f5d065e46999129553060165f815e9a4",
		StorageClass: "sqlite",
	},
	{
		ID:           "s08c_001",
		Owner:        "S08-C",
		Artifact:     "go/migrations/s08c_001-run-learning.sql",
		SHA256:       "85b735090917fb570b7bcbe7afa229e14b5145d419d3ccdee74a44f8d47c8c43",
		StorageClass: "sqlite",
	},
}

var migrations = []core.Migration{
	{
		Version: 1,
		Name:    "AO-14 product schema",
		SQL: `CREATE TABLE sen_messages (
			id TEXT PRIMARY KEY,
			session_id TEXT NOT NULL,
			role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
			content TEXT NOT NULL,
			metadata JSON,
			created_at TEXT NOT NULL CHECK(created_at GLOB '????-??-??T??:??:??.???Z')
		);
		CREATE TABLE run_refs (
			run_id TEXT PRIMARY KEY,
			goal_id TEXT NOT NULL,
			status TEXT NOT NULL,
			outcome TEXT,
			summary TEXT,
			started_at TEXT NOT NULL CHECK(started_at GLOB '????-??-??T??:??:??.???Z'),
			ended_at TEXT CHECK(ended_at IS NULL OR ended_at GLOB '????-??-??T??:??:??.???Z'),
			metadata JSON,
			synced_at TEXT NOT NULL CHECK(synced_at GLOB '????-??-??T??:??:??.???Z')
		);
		CREATE TABLE command_receipts (
			command_id TEXT PRIMARY KEY,
			command_type TEXT NOT NULL,
			actor_id TEXT NOT NULL,
			status TEXT NOT NULL,
			payload JSON,
			result JSON,
			error TEXT,
			executed_at TEXT NOT NULL CHECK(executed_at GLOB '????-??-??T??:??:??.???Z')
		);
		CREATE TABLE export_candidates (
			id TEXT PRIMARY KEY,
			source_type TEXT NOT NULL,
			source_id TEXT NOT NULL,
			export_format TEXT NOT NULL,
			content_hash TEXT NOT NULL,
			status TEXT NOT NULL CHECK(status IN ('pending', 'exported', 'failed', 'quarantined')),
			created_at TEXT NOT NULL CHECK(created_at GLOB '????-??-??T??:??:??.???Z'),
			exported_at TEXT CHECK(exported_at IS NULL OR exported_at GLOB '????-??-??T??:??:??.???Z')
		);
		CREATE INDEX idx_sen_messages_session ON sen_messages(session_id, created_at);
		CREATE INDEX idx_run_refs_goal ON run_refs(goal_id);
		CREATE INDEX idx_export_status ON export_candidates(status);`,
	},
	{
		Version: 2,
		Name:    "export candidate acknowledgement invariants",
		SQL: `CREATE TRIGGER export_candidates_insert_rules
		BEFORE INSERT ON export_candidates
		WHEN NEW.status != 'pending' OR NEW.exported_at IS NOT NULL
		BEGIN
			SELECT RAISE(ABORT, 'export candidates must be inserted pending');
		END;
		CREATE TRIGGER export_candidates_immutable
		BEFORE UPDATE ON export_candidates
		WHEN NEW.id != OLD.id OR NEW.source_type != OLD.source_type OR NEW.source_id != OLD.source_id OR
			NEW.export_format != OLD.export_format OR NEW.content_hash != OLD.content_hash OR NEW.created_at != OLD.created_at
		BEGIN
			SELECT RAISE(ABORT, 'export candidate identity is immutable');
		END;
		CREATE TRIGGER export_candidates_transition
		BEFORE UPDATE OF status, exported_at ON export_candidates
		WHEN NOT (
			(OLD.status = 'pending' AND NEW.status = 'exported' AND NEW.exported_at IS NOT NULL) OR
			(OLD.status = 'pending' AND NEW.status IN ('failed', 'quarantined') AND NEW.exported_at IS NULL) OR
			(OLD.status = NEW.status AND NEW.exported_at IS OLD.exported_at)
		)
		BEGIN
			SELECT RAISE(ABORT, 'invalid export candidate transition');
		END;`,
	},
	{
		Version: 3,
		Name:    "SEN chat durability sessions turns attempts events checkpoints",
		SQL:     chatDurabilitySQL,
	},
}

// chatDurabilitySQL is the forward migration for ADP-01 durable SEN Chat.
// Mirrored at go/migrations/000003_sen_chat_durability.sql.
const chatDurabilitySQL = `CREATE TABLE sen_sessions (
			session_id TEXT PRIMARY KEY,
			workspace_id TEXT NOT NULL,
			title TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL CHECK(status IN ('active', 'archived')),
			selected_builder_policy TEXT NOT NULL DEFAULT '',
			version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
			created_at TEXT NOT NULL CHECK(created_at GLOB '????-??-??T??:??:??.???Z'),
			updated_at TEXT NOT NULL CHECK(updated_at GLOB '????-??-??T??:??:??.???Z'),
			archived_at TEXT CHECK(archived_at IS NULL OR archived_at GLOB '????-??-??T??:??:??.???Z')
		);
		CREATE TABLE sen_session_turns (
			turn_id TEXT PRIMARY KEY,
			session_id TEXT NOT NULL REFERENCES sen_sessions(session_id) ON DELETE RESTRICT,
			turn_seq INTEGER NOT NULL CHECK(turn_seq >= 1),
			role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
			message_kind TEXT NOT NULL DEFAULT 'text',
			content TEXT NOT NULL,
			chat_attempt_id TEXT,
			client_command_id TEXT,
			outcome_status TEXT CHECK(outcome_status IS NULL OR outcome_status IN ('succeeded', 'failed', 'cancelled', 'no_response')),
			recorded_at TEXT NOT NULL CHECK(recorded_at GLOB '????-??-??T??:??:??.???Z'),
			UNIQUE(session_id, turn_seq)
		);
		CREATE UNIQUE INDEX idx_sen_session_turns_client_command
			ON sen_session_turns(client_command_id) WHERE client_command_id IS NOT NULL;
		CREATE TABLE sen_chat_attempts (
			chat_attempt_id TEXT PRIMARY KEY,
			session_id TEXT NOT NULL REFERENCES sen_sessions(session_id) ON DELETE RESTRICT,
			input_first_turn_seq INTEGER NOT NULL CHECK(input_first_turn_seq >= 1),
			input_last_turn_seq INTEGER NOT NULL CHECK(input_last_turn_seq >= input_first_turn_seq),
			ordinal INTEGER NOT NULL CHECK(ordinal >= 1),
			state TEXT NOT NULL CHECK(state IN ('queued', 'claimed', 'running', 'succeeded', 'failed', 'cancelled', 'no_response')),
			builder_id TEXT NOT NULL DEFAULT '',
			lease_owner TEXT NOT NULL DEFAULT '',
			lease_generation INTEGER NOT NULL DEFAULT 0 CHECK(lease_generation >= 0),
			version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
			client_command_id TEXT NOT NULL,
			error_text TEXT,
			created_at TEXT NOT NULL CHECK(created_at GLOB '????-??-??T??:??:??.???Z'),
			updated_at TEXT NOT NULL CHECK(updated_at GLOB '????-??-??T??:??:??.???Z'),
			UNIQUE(session_id, ordinal),
			UNIQUE(client_command_id)
		);
		CREATE TABLE sen_chat_events (
			chat_attempt_id TEXT NOT NULL REFERENCES sen_chat_attempts(chat_attempt_id) ON DELETE RESTRICT,
			seq INTEGER NOT NULL CHECK(seq >= 1),
			event_kind TEXT NOT NULL,
			payload JSON,
			redaction_class TEXT NOT NULL DEFAULT 'allow',
			recorded_at TEXT NOT NULL CHECK(recorded_at GLOB '????-??-??T??:??:??.???Z'),
			PRIMARY KEY (chat_attempt_id, seq)
		);
		CREATE TABLE sen_runtime_checkpoints (
			session_id TEXT NOT NULL,
			builder_id TEXT NOT NULL,
			runtime_profile TEXT NOT NULL DEFAULT '',
			provider_checkpoint_ref TEXT NOT NULL DEFAULT '',
			workdir_ref TEXT NOT NULL DEFAULT '',
			owning_attempt_id TEXT,
			lease_generation INTEGER NOT NULL DEFAULT 0 CHECK(lease_generation >= 0),
			valid INTEGER NOT NULL DEFAULT 1 CHECK(valid IN (0, 1)),
			pinned_at TEXT NOT NULL CHECK(pinned_at GLOB '????-??-??T??:??:??.???Z'),
			retired_at TEXT CHECK(retired_at IS NULL OR retired_at GLOB '????-??-??T??:??:??.???Z'),
			PRIMARY KEY (session_id, builder_id, runtime_profile)
		);
		CREATE INDEX idx_sen_sessions_workspace ON sen_sessions(workspace_id, updated_at);
		CREATE INDEX idx_sen_session_turns_session ON sen_session_turns(session_id, turn_seq);
		CREATE INDEX idx_sen_chat_attempts_session_state ON sen_chat_attempts(session_id, state, ordinal);
		CREATE INDEX idx_sen_chat_events_attempt ON sen_chat_events(chat_attempt_id, seq);
		CREATE TRIGGER sen_chat_attempts_terminal_immutable
		BEFORE UPDATE OF state ON sen_chat_attempts
		WHEN OLD.state IN ('succeeded', 'failed', 'cancelled', 'no_response')
			AND NEW.state != OLD.state
		BEGIN
			SELECT RAISE(ABORT, 'terminal chat attempt state is immutable');
		END;`
