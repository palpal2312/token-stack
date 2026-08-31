-- 000003_sen_chat_durability.sql
-- Forward migration for ADP-01 durable SEN Chat authority.
-- Applied by product.Open via embedded schema version 3; keep this file
-- byte-identical to product.chatDurabilitySQL (minus this comment header).

CREATE TABLE sen_sessions (
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
END;
