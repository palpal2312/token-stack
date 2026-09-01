package product

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

const (
	maxEventBatch    = 64
	chatSendCommand  = "sen.chat.send_turn"
	chatCompleteCmd  = "sen.chat.complete_attempt"
	activeAttemptSQL = `SELECT chat_attempt_id, session_id, input_first_turn_seq, input_last_turn_seq, ordinal, state,
		builder_id, lease_owner, lease_generation, version, client_command_id, error_text, created_at, updated_at
		FROM sen_chat_attempts WHERE session_id = ? AND state IN ('queued', 'claimed', 'running')
		ORDER BY ordinal DESC LIMIT 1`
)

var (
	terminalAttemptStates = map[string]bool{
		"succeeded": true, "failed": true, "cancelled": true, "no_response": true,
	}
	activeAttemptStates = map[string]bool{
		"queued": true, "claimed": true, "running": true,
	}
)

// Session is durable SEN chat session metadata.
type Session struct {
	SessionID, WorkspaceID, Title, Status, SelectedBuilderPolicy string
	Version                                                      int
	CreatedAt, UpdatedAt                                         time.Time
	ArchivedAt                                                   *time.Time
}

// Turn is one ordered conversation turn.
type Turn struct {
	TurnID, SessionID, Role, MessageKind, Content string
	TurnSeq                                       int
	ChatAttemptID, ClientCommandID, OutcomeStatus *string
	RecordedAt                                    time.Time
}

// ChatAttempt is one immutable-input chat execution record.
type ChatAttempt struct {
	ChatAttemptID, SessionID, State, BuilderID, LeaseOwner, ClientCommandID string
	InputFirstTurnSeq, InputLastTurnSeq, Ordinal, LeaseGeneration, Version  int
	ErrorText                                                               *string
	CreatedAt, UpdatedAt                                                    time.Time
}

// ChatEvent is one sequenced progress/terminal stream event.
type ChatEvent struct {
	ChatAttemptID, EventKind, RedactionClass string
	Seq                                      int
	Payload                                  []byte
	RecordedAt                               time.Time
}

// RuntimeCheckpoint binds a provider resume token to exact compatibility keys.
type RuntimeCheckpoint struct {
	SessionID, BuilderID, RuntimeProfile string
	ProviderCheckpointRef, WorkdirRef    string
	OwningAttemptID                      *string
	LeaseGeneration                      int
	Valid                                bool
	PinnedAt                             time.Time
	RetiredAt                            *time.Time
}

// SendTurnInput is the persist-before-ack send command.
type SendTurnInput struct {
	CommandID, SessionID, WorkspaceID, Content, BuilderPolicy string
	Role                                                       string // optional; default "user"
	Now                                                        time.Time
}

// SendTurnReceipt is returned only after the durable commit.
type SendTurnReceipt struct {
	CommandID, SessionID, TurnID, ChatAttemptID, Status string
	TurnSeq                                             int
}

// CompleteAttemptInput commits exactly one terminal outcome.
type CompleteAttemptInput struct {
	CommandID, ChatAttemptID, Content, Outcome, ErrorText string
	Now                                                   time.Time
}

// CompleteAttemptReceipt is the terminal commit result.
type CompleteAttemptReceipt struct {
	CommandID, ChatAttemptID, TurnID, Status string
	TurnSeq                                  int
}

// SendTurn creates/touches a session, appends the user turn, queues an attempt,
// and stores an idempotent command receipt before returning.
func SendTurn(ctx context.Context, db *sql.DB, input SendTurnInput) (SendTurnReceipt, error) {
	var zero SendTurnReceipt
	if db == nil {
		return zero, errors.New("database connection is required")
	}
	if input.CommandID == "" || input.SessionID == "" || input.WorkspaceID == "" || input.Content == "" {
		return zero, errors.New("command id, session id, workspace id, and content are required")
	}
	role := input.Role
	if role == "" {
		role = "user"
	}
	if !validRoles[role] {
		return zero, errors.New("role must be user, assistant, or system")
	}
	now := input.Now
	if now.IsZero() {
		now = time.Now().UTC()
	}
	stamp, err := utcTimestamp(now)
	if err != nil {
		return zero, err
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return zero, err
	}
	defer tx.Rollback()

	if receipt, ok, err := loadSendReceipt(ctx, tx, input.CommandID); err != nil {
		return zero, err
	} else if ok {
		if receipt.SessionID != input.SessionID {
			return zero, fmt.Errorf("command %q conflicts with existing send receipt", input.CommandID)
		}
		return receipt, nil
	}

	if err := ensureSessionTx(ctx, tx, input.SessionID, input.WorkspaceID, input.BuilderPolicy, stamp); err != nil {
		return zero, err
	}

	var lastSeq sql.NullInt64
	if err := tx.QueryRowContext(ctx, `SELECT MAX(turn_seq) FROM sen_session_turns WHERE session_id = ?`, input.SessionID).Scan(&lastSeq); err != nil {
		return zero, err
	}
	turnSeq := 1
	if lastSeq.Valid {
		turnSeq = int(lastSeq.Int64) + 1
	}
	turnID := fmt.Sprintf("turn-%s-%d", input.SessionID, turnSeq)
	attemptID := fmt.Sprintf("attempt-%s-%d", input.SessionID, turnSeq)

	var nextOrdinal sql.NullInt64
	if err := tx.QueryRowContext(ctx, `SELECT MAX(ordinal) FROM sen_chat_attempts WHERE session_id = ?`, input.SessionID).Scan(&nextOrdinal); err != nil {
		return zero, err
	}
	ordinal := 1
	if nextOrdinal.Valid {
		ordinal = int(nextOrdinal.Int64) + 1
	}

	if _, err := tx.ExecContext(ctx, `INSERT INTO sen_session_turns
		(turn_id, session_id, turn_seq, role, message_kind, content, chat_attempt_id, client_command_id, outcome_status, recorded_at)
		VALUES (?, ?, ?, ?, 'text', ?, ?, ?, NULL, ?)`,
		turnID, input.SessionID, turnSeq, role, input.Content, attemptID, input.CommandID, stamp); err != nil {
		return zero, fmt.Errorf("insert turn: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO sen_chat_attempts
		(chat_attempt_id, session_id, input_first_turn_seq, input_last_turn_seq, ordinal, state, builder_id,
		 lease_owner, lease_generation, version, client_command_id, error_text, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, 'queued', ?, '', 0, 1, ?, NULL, ?, ?)`,
		attemptID, input.SessionID, turnSeq, turnSeq, ordinal, input.BuilderPolicy, input.CommandID, stamp, stamp); err != nil {
		return zero, fmt.Errorf("queue chat attempt: %w", err)
	}

	receipt := SendTurnReceipt{
		CommandID: input.CommandID, SessionID: input.SessionID, TurnID: turnID,
		TurnSeq: turnSeq, ChatAttemptID: attemptID, Status: "queued",
	}
	resultJSON, err := json.Marshal(receipt)
	if err != nil {
		return zero, err
	}
	payloadJSON, err := json.Marshal(map[string]string{
		"sessionId": input.SessionID, "workspaceId": input.WorkspaceID, "content": input.Content,
	})
	if err != nil {
		return zero, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO command_receipts
		(command_id, command_type, actor_id, status, payload, result, error, executed_at)
		VALUES (?, ?, 'sen-chat', 'completed', ?, ?, NULL, ?)`,
		input.CommandID, chatSendCommand, payloadJSON, resultJSON, stamp); err != nil {
		return zero, fmt.Errorf("store send receipt: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return zero, err
	}
	return receipt, nil
}

// CompleteAttempt commits one terminal turn and attempt state exactly once.
func CompleteAttempt(ctx context.Context, db *sql.DB, input CompleteAttemptInput) (CompleteAttemptReceipt, error) {
	var zero CompleteAttemptReceipt
	if db == nil {
		return zero, errors.New("database connection is required")
	}
	if input.CommandID == "" || input.ChatAttemptID == "" || !terminalAttemptStates[input.Outcome] {
		return zero, errors.New("command id, chat attempt id, and terminal outcome are required")
	}
	now := input.Now
	if now.IsZero() {
		now = time.Now().UTC()
	}
	stamp, err := utcTimestamp(now)
	if err != nil {
		return zero, err
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return zero, err
	}
	defer tx.Rollback()

	if receipt, ok, err := loadCompleteReceipt(ctx, tx, input.CommandID); err != nil {
		return zero, err
	} else if ok {
		if receipt.ChatAttemptID != input.ChatAttemptID || receipt.Status != input.Outcome {
			return zero, fmt.Errorf("command %q conflicts with existing complete receipt", input.CommandID)
		}
		return receipt, nil
	}

	attempt, err := scanAttempt(tx.QueryRowContext(ctx, `SELECT chat_attempt_id, session_id, input_first_turn_seq, input_last_turn_seq, ordinal, state,
		builder_id, lease_owner, lease_generation, version, client_command_id, error_text, created_at, updated_at
		FROM sen_chat_attempts WHERE chat_attempt_id = ?`, input.ChatAttemptID))
	if errors.Is(err, sql.ErrNoRows) {
		return zero, fmt.Errorf("chat attempt %q not found", input.ChatAttemptID)
	}
	if err != nil {
		return zero, err
	}
	if terminalAttemptStates[attempt.State] {
		if attempt.State != input.Outcome {
			return zero, fmt.Errorf("chat attempt %q already terminal as %s", input.ChatAttemptID, attempt.State)
		}
		// Recover receipt shape from existing terminal turn when command differs but outcome matches.
		var turnID string
		var turnSeq int
		err := tx.QueryRowContext(ctx, `SELECT turn_id, turn_seq FROM sen_session_turns
			WHERE chat_attempt_id = ? AND role = 'assistant' ORDER BY turn_seq DESC LIMIT 1`, input.ChatAttemptID).
			Scan(&turnID, &turnSeq)
		if err != nil {
			return zero, fmt.Errorf("load terminal turn: %w", err)
		}
		return CompleteAttemptReceipt{
			CommandID: input.CommandID, ChatAttemptID: input.ChatAttemptID, TurnID: turnID, TurnSeq: turnSeq, Status: input.Outcome,
		}, nil
	}
	if !activeAttemptStates[attempt.State] {
		return zero, fmt.Errorf("chat attempt %q is not completable from state %s", input.ChatAttemptID, attempt.State)
	}

	var lastSeq int
	if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(turn_seq), 0) FROM sen_session_turns WHERE session_id = ?`, attempt.SessionID).Scan(&lastSeq); err != nil {
		return zero, err
	}
	turnSeq := lastSeq + 1
	turnID := fmt.Sprintf("turn-%s-%d", attempt.SessionID, turnSeq)
	content := input.Content
	if content == "" {
		content = input.Outcome
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO sen_session_turns
		(turn_id, session_id, turn_seq, role, message_kind, content, chat_attempt_id, client_command_id, outcome_status, recorded_at)
		VALUES (?, ?, ?, 'assistant', 'text', ?, ?, NULL, ?, ?)`,
		turnID, attempt.SessionID, turnSeq, content, input.ChatAttemptID, input.Outcome, stamp); err != nil {
		return zero, fmt.Errorf("insert terminal turn: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE sen_chat_attempts SET state = ?, version = version + 1, updated_at = ?, error_text = ?
		WHERE chat_attempt_id = ? AND state IN ('queued', 'claimed', 'running')`,
		input.Outcome, stamp, input.ErrorTextOrNil(), input.ChatAttemptID); err != nil {
		return zero, fmt.Errorf("close chat attempt: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE sen_sessions SET version = version + 1, updated_at = ? WHERE session_id = ?`,
		stamp, attempt.SessionID); err != nil {
		return zero, err
	}

	receipt := CompleteAttemptReceipt{
		CommandID: input.CommandID, ChatAttemptID: input.ChatAttemptID, TurnID: turnID, TurnSeq: turnSeq, Status: input.Outcome,
	}
	resultJSON, err := json.Marshal(receipt)
	if err != nil {
		return zero, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO command_receipts
		(command_id, command_type, actor_id, status, payload, result, error, executed_at)
		VALUES (?, ?, 'sen-chat', 'completed', NULL, ?, NULL, ?)`,
		input.CommandID, chatCompleteCmd, resultJSON, stamp); err != nil {
		return zero, fmt.Errorf("store complete receipt: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return zero, err
	}
	return receipt, nil
}

// ErrorTextOrNil exposes optional error text for CompleteAttemptInput.
func (input CompleteAttemptInput) ErrorTextOrNil() any {
	if input.ErrorText == "" {
		return nil
	}
	return input.ErrorText
}

// AppendEventBatch inserts a bounded sequenced batch atomically.
// Exact duplicate rows are ignored; conflicting payloads for an existing seq fail.
func AppendEventBatch(ctx context.Context, db *sql.DB, attemptID string, events []ChatEvent) error {
	if db == nil {
		return errors.New("database connection is required")
	}
	if attemptID == "" {
		return errors.New("chat attempt id is required")
	}
	if len(events) == 0 {
		return errors.New("event batch is required")
	}
	if len(events) > maxEventBatch {
		return fmt.Errorf("event batch exceeds bound of %d", maxEventBatch)
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var exists int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(1) FROM sen_chat_attempts WHERE chat_attempt_id = ?`, attemptID).Scan(&exists); err != nil {
		return err
	}
	if exists != 1 {
		return fmt.Errorf("chat attempt %q not found", attemptID)
	}

	for _, event := range events {
		if event.ChatAttemptID == "" {
			event.ChatAttemptID = attemptID
		}
		if event.ChatAttemptID != attemptID || event.Seq < 1 || event.EventKind == "" {
			return errors.New("each event requires matching attempt id, positive seq, and event kind")
		}
		if event.RedactionClass == "" {
			event.RedactionClass = "allow"
		}
		stamp, err := utcTimestamp(event.RecordedAt)
		if err != nil {
			return err
		}
		result, err := tx.ExecContext(ctx, `INSERT INTO sen_chat_events
			(chat_attempt_id, seq, event_kind, payload, redaction_class, recorded_at)
			VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(chat_attempt_id, seq) DO NOTHING`,
			attemptID, event.Seq, event.EventKind, nullableBytes(event.Payload), event.RedactionClass, stamp)
		if err != nil {
			return err
		}
		inserted, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if inserted == 1 {
			continue
		}
		var kind, redaction, recorded string
		var payload []byte
		if err := tx.QueryRowContext(ctx, `SELECT event_kind, payload, redaction_class, recorded_at FROM sen_chat_events
			WHERE chat_attempt_id = ? AND seq = ?`, attemptID, event.Seq).
			Scan(&kind, &payload, &redaction, &recorded); err != nil {
			return err
		}
		if kind != event.EventKind || redaction != event.RedactionClass || recorded != stamp || string(payload) != string(event.Payload) {
			return fmt.Errorf("event seq %d conflicts with existing event", event.Seq)
		}
	}
	return tx.Commit()
}

// ListEventsAfter returns ordered events with seq greater than afterSeq.
func ListEventsAfter(ctx context.Context, db *sql.DB, attemptID string, afterSeq, limit int) ([]ChatEvent, error) {
	if db == nil {
		return nil, errors.New("database connection is required")
	}
	if attemptID == "" || afterSeq < 0 || limit <= 0 {
		return nil, errors.New("attempt id, non-negative after_seq, and positive limit are required")
	}
	rows, err := db.QueryContext(ctx, `SELECT chat_attempt_id, seq, event_kind, payload, redaction_class, recorded_at
		FROM sen_chat_events WHERE chat_attempt_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?`,
		attemptID, afterSeq, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var events []ChatEvent
	for rows.Next() {
		var event ChatEvent
		var recorded string
		if err := rows.Scan(&event.ChatAttemptID, &event.Seq, &event.EventKind, &event.Payload, &event.RedactionClass, &recorded); err != nil {
			return nil, err
		}
		event.RecordedAt, err = time.Parse(timestampLayout, recorded)
		if err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	return events, rows.Err()
}

// ListTurnsAfter returns ordered turns with turn_seq greater than afterSeq.
func ListTurnsAfter(ctx context.Context, db *sql.DB, sessionID string, afterSeq, limit int) ([]Turn, error) {
	if db == nil {
		return nil, errors.New("database connection is required")
	}
	if sessionID == "" || afterSeq < 0 || limit <= 0 {
		return nil, errors.New("session id, non-negative after_seq, and positive limit are required")
	}
	rows, err := db.QueryContext(ctx, `SELECT turn_id, session_id, turn_seq, role, message_kind, content,
		chat_attempt_id, client_command_id, outcome_status, recorded_at
		FROM sen_session_turns WHERE session_id = ? AND turn_seq > ? ORDER BY turn_seq ASC LIMIT ?`,
		sessionID, afterSeq, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var turns []Turn
	for rows.Next() {
		var turn Turn
		var attemptID, commandID, outcome sql.NullString
		var recorded string
		if err := rows.Scan(&turn.TurnID, &turn.SessionID, &turn.TurnSeq, &turn.Role, &turn.MessageKind, &turn.Content,
			&attemptID, &commandID, &outcome, &recorded); err != nil {
			return nil, err
		}
		turn.ChatAttemptID = nullStringPtr(attemptID)
		turn.ClientCommandID = nullStringPtr(commandID)
		turn.OutcomeStatus = nullStringPtr(outcome)
		turn.RecordedAt, err = time.Parse(timestampLayout, recorded)
		if err != nil {
			return nil, err
		}
		turns = append(turns, turn)
	}
	return turns, rows.Err()
}

// GetActiveAttempt returns the newest queued/claimed/running attempt, if any.
func GetActiveAttempt(ctx context.Context, db *sql.DB, sessionID string) (*ChatAttempt, error) {
	if db == nil {
		return nil, errors.New("database connection is required")
	}
	if sessionID == "" {
		return nil, errors.New("session id is required")
	}
	attempt, err := scanAttempt(db.QueryRowContext(ctx, activeAttemptSQL, sessionID))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &attempt, nil
}

// PinCheckpoint upserts a valid runtime checkpoint for the exact compatibility key.
func PinCheckpoint(ctx context.Context, db *sql.DB, checkpoint RuntimeCheckpoint) error {
	if db == nil {
		return errors.New("database connection is required")
	}
	if checkpoint.SessionID == "" || checkpoint.BuilderID == "" {
		return errors.New("session id and builder id are required")
	}
	stamp, err := utcTimestamp(checkpoint.PinnedAt)
	if err != nil {
		return err
	}
	var owning any
	if checkpoint.OwningAttemptID != nil {
		owning = *checkpoint.OwningAttemptID
	}
	_, err = db.ExecContext(ctx, `INSERT INTO sen_runtime_checkpoints
		(session_id, builder_id, runtime_profile, provider_checkpoint_ref, workdir_ref, owning_attempt_id,
		 lease_generation, valid, pinned_at, retired_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, NULL)
		ON CONFLICT(session_id, builder_id, runtime_profile) DO UPDATE SET
			provider_checkpoint_ref = excluded.provider_checkpoint_ref,
			workdir_ref = excluded.workdir_ref,
			owning_attempt_id = excluded.owning_attempt_id,
			lease_generation = excluded.lease_generation,
			valid = 1,
			pinned_at = excluded.pinned_at,
			retired_at = NULL`,
		checkpoint.SessionID, checkpoint.BuilderID, checkpoint.RuntimeProfile,
		checkpoint.ProviderCheckpointRef, checkpoint.WorkdirRef, owning,
		checkpoint.LeaseGeneration, stamp)
	return err
}

// LoadCompatibleCheckpoint returns the valid checkpoint for the exact key, if any.
func LoadCompatibleCheckpoint(ctx context.Context, db *sql.DB, sessionID, builderID, runtimeProfile string) (*RuntimeCheckpoint, error) {
	if db == nil {
		return nil, errors.New("database connection is required")
	}
	row := db.QueryRowContext(ctx, `SELECT session_id, builder_id, runtime_profile, provider_checkpoint_ref, workdir_ref,
		owning_attempt_id, lease_generation, valid, pinned_at, retired_at
		FROM sen_runtime_checkpoints WHERE session_id = ? AND builder_id = ? AND runtime_profile = ? AND valid = 1`,
		sessionID, builderID, runtimeProfile)
	checkpoint, err := scanCheckpoint(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &checkpoint, nil
}

// CompareAndClearCheckpoint retires a checkpoint only when the exact binding matches.
func CompareAndClearCheckpoint(ctx context.Context, db *sql.DB, sessionID, builderID, runtimeProfile, owningAttemptID string, leaseGeneration int, now time.Time) (bool, error) {
	if db == nil {
		return false, errors.New("database connection is required")
	}
	if sessionID == "" || builderID == "" || owningAttemptID == "" {
		return false, errors.New("session id, builder id, and owning attempt id are required")
	}
	stamp, err := utcTimestamp(now)
	if err != nil {
		return false, err
	}
	result, err := db.ExecContext(ctx, `UPDATE sen_runtime_checkpoints
		SET valid = 0, retired_at = ?
		WHERE session_id = ? AND builder_id = ? AND runtime_profile = ?
			AND owning_attempt_id = ? AND lease_generation = ? AND valid = 1`,
		stamp, sessionID, builderID, runtimeProfile, owningAttemptID, leaseGeneration)
	if err != nil {
		return false, err
	}
	n, err := result.RowsAffected()
	return n == 1, err
}

func ensureSessionTx(ctx context.Context, tx *sql.Tx, sessionID, workspaceID, builderPolicy, stamp string) error {
	result, err := tx.ExecContext(ctx, `INSERT INTO sen_sessions
		(session_id, workspace_id, title, status, selected_builder_policy, version, created_at, updated_at, archived_at)
		VALUES (?, ?, '', 'active', ?, 1, ?, ?, NULL)
		ON CONFLICT(session_id) DO NOTHING`, sessionID, workspaceID, builderPolicy, stamp, stamp)
	if err != nil {
		return err
	}
	inserted, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if inserted == 1 {
		return nil
	}
	var workspace string
	if err := tx.QueryRowContext(ctx, `SELECT workspace_id FROM sen_sessions WHERE session_id = ?`, sessionID).Scan(&workspace); err != nil {
		return err
	}
	if workspace != workspaceID {
		return fmt.Errorf("session %q workspace conflicts", sessionID)
	}
	_, err = tx.ExecContext(ctx, `UPDATE sen_sessions SET version = version + 1, updated_at = ?,
		selected_builder_policy = CASE WHEN ? != '' THEN ? ELSE selected_builder_policy END
		WHERE session_id = ?`, stamp, builderPolicy, builderPolicy, sessionID)
	return err
}

func loadSendReceipt(ctx context.Context, tx *sql.Tx, commandID string) (SendTurnReceipt, bool, error) {
	var zero SendTurnReceipt
	var commandType, status string
	var result []byte
	err := tx.QueryRowContext(ctx, `SELECT command_type, status, result FROM command_receipts WHERE command_id = ?`, commandID).
		Scan(&commandType, &status, &result)
	if errors.Is(err, sql.ErrNoRows) {
		return zero, false, nil
	}
	if err != nil {
		return zero, false, err
	}
	if commandType != chatSendCommand || status != "completed" {
		return zero, false, fmt.Errorf("command %q is not a completed send receipt", commandID)
	}
	var receipt SendTurnReceipt
	if err := json.Unmarshal(result, &receipt); err != nil {
		return zero, false, err
	}
	return receipt, true, nil
}

func loadCompleteReceipt(ctx context.Context, tx *sql.Tx, commandID string) (CompleteAttemptReceipt, bool, error) {
	var zero CompleteAttemptReceipt
	var commandType, status string
	var result []byte
	err := tx.QueryRowContext(ctx, `SELECT command_type, status, result FROM command_receipts WHERE command_id = ?`, commandID).
		Scan(&commandType, &status, &result)
	if errors.Is(err, sql.ErrNoRows) {
		return zero, false, nil
	}
	if err != nil {
		return zero, false, err
	}
	if commandType != chatCompleteCmd || status != "completed" {
		return zero, false, fmt.Errorf("command %q is not a completed complete receipt", commandID)
	}
	var receipt CompleteAttemptReceipt
	if err := json.Unmarshal(result, &receipt); err != nil {
		return zero, false, err
	}
	return receipt, true, nil
}

func scanAttempt(row *sql.Row) (ChatAttempt, error) {
	var attempt ChatAttempt
	var errText sql.NullString
	var created, updated string
	err := row.Scan(&attempt.ChatAttemptID, &attempt.SessionID, &attempt.InputFirstTurnSeq, &attempt.InputLastTurnSeq,
		&attempt.Ordinal, &attempt.State, &attempt.BuilderID, &attempt.LeaseOwner, &attempt.LeaseGeneration,
		&attempt.Version, &attempt.ClientCommandID, &errText, &created, &updated)
	if err != nil {
		return ChatAttempt{}, err
	}
	attempt.ErrorText = nullStringPtr(errText)
	attempt.CreatedAt, err = time.Parse(timestampLayout, created)
	if err != nil {
		return ChatAttempt{}, err
	}
	attempt.UpdatedAt, err = time.Parse(timestampLayout, updated)
	return attempt, err
}

func scanCheckpoint(row *sql.Row) (RuntimeCheckpoint, error) {
	var checkpoint RuntimeCheckpoint
	var owning sql.NullString
	var valid int
	var pinned string
	var retired sql.NullString
	err := row.Scan(&checkpoint.SessionID, &checkpoint.BuilderID, &checkpoint.RuntimeProfile,
		&checkpoint.ProviderCheckpointRef, &checkpoint.WorkdirRef, &owning, &checkpoint.LeaseGeneration,
		&valid, &pinned, &retired)
	if err != nil {
		return RuntimeCheckpoint{}, err
	}
	checkpoint.OwningAttemptID = nullStringPtr(owning)
	checkpoint.Valid = valid == 1
	checkpoint.PinnedAt, err = time.Parse(timestampLayout, pinned)
	if err != nil {
		return RuntimeCheckpoint{}, err
	}
	if retired.Valid {
		t, err := time.Parse(timestampLayout, retired.String)
		if err != nil {
			return RuntimeCheckpoint{}, err
		}
		checkpoint.RetiredAt = &t
	}
	return checkpoint, nil
}

func nullStringPtr(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	v := value.String
	return &v
}
