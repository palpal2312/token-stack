package product

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func openChatDB(t *testing.T) (*sql.DB, string) {
	t.Helper()
	root := t.TempDir()
	db, err := Open(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	return db, root
}

func TestChatSchemaMigrationAndConstraints(t *testing.T) {
	db, _ := openChatDB(t)
	defer db.Close()

	wantTables := []string{"sen_sessions", "sen_session_turns", "sen_chat_attempts", "sen_chat_events", "sen_runtime_checkpoints"}
	for _, table := range wantTables {
		var count int
		if err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?`, table).Scan(&count); err != nil || count != 1 {
			t.Fatalf("table %s count=%d err=%v", table, count, err)
		}
	}
	if _, err := db.Exec(`INSERT INTO sen_chat_attempts
		(chat_attempt_id, session_id, input_first_turn_seq, input_last_turn_seq, ordinal, state, builder_id,
		 lease_owner, lease_generation, version, client_command_id, error_text, created_at, updated_at)
		VALUES ('a','missing',1,1,1,'queued','','',0,1,'c',NULL,'2026-08-25T00:00:00.000Z','2026-08-25T00:00:00.000Z')`); err == nil {
		t.Fatal("FK allowed attempt without session")
	}
}

func TestSendTurnPersistBeforeAckIdempotentAndConflict(t *testing.T) {
	ctx := context.Background()
	db, root := openChatDB(t)
	defer db.Close()
	now := time.Date(2026, 8, 25, 12, 0, 0, 123000000, time.UTC)

	first, err := SendTurn(ctx, db, SendTurnInput{
		CommandID: "cmd-1", SessionID: "s1", WorkspaceID: "ws", Content: "hello", BuilderPolicy: "claude", Now: now,
	})
	if err != nil {
		t.Fatal(err)
	}
	if first.Status != "queued" || first.TurnSeq != 1 || first.ChatAttemptID == "" {
		t.Fatalf("unexpected receipt: %+v", first)
	}
	replay, err := SendTurn(ctx, db, SendTurnInput{
		CommandID: "cmd-1", SessionID: "s1", WorkspaceID: "ws", Content: "hello", BuilderPolicy: "claude", Now: now,
	})
	if err != nil {
		t.Fatal(err)
	}
	if replay != first {
		t.Fatalf("replay receipt = %+v, want %+v", replay, first)
	}
	if _, err := SendTurn(ctx, db, SendTurnInput{
		CommandID: "cmd-1", SessionID: "other", WorkspaceID: "ws", Content: "hello", Now: now,
	}); err == nil {
		t.Fatal("conflicting session replay accepted")
	}

	var turnCount, attemptCount int
	if err := db.QueryRow(`SELECT COUNT(*) FROM sen_session_turns WHERE session_id='s1'`).Scan(&turnCount); err != nil || turnCount != 1 {
		t.Fatalf("turns=%d err=%v", turnCount, err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM sen_chat_attempts WHERE session_id='s1'`).Scan(&attemptCount); err != nil || attemptCount != 1 {
		t.Fatalf("attempts=%d err=%v", attemptCount, err)
	}

	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	db, err = Open(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	afterRestart, err := SendTurn(ctx, db, SendTurnInput{
		CommandID: "cmd-1", SessionID: "s1", WorkspaceID: "ws", Content: "hello", BuilderPolicy: "claude", Now: now,
	})
	if err != nil {
		t.Fatal(err)
	}
	if afterRestart != first {
		t.Fatalf("restart replay = %+v, want %+v", afterRestart, first)
	}
	active, err := GetActiveAttempt(ctx, db, "s1")
	if err != nil || active == nil || active.ChatAttemptID != first.ChatAttemptID || active.State != "queued" {
		t.Fatalf("active after restart = %+v err=%v", active, err)
	}
}

func TestEventBatchIdempotencyOrderingAndBound(t *testing.T) {
	ctx := context.Background()
	db, _ := openChatDB(t)
	defer db.Close()
	now := time.Date(2026, 8, 25, 13, 0, 0, 0, time.UTC)
	send, err := SendTurn(ctx, db, SendTurnInput{
		CommandID: "cmd-e", SessionID: "s-e", WorkspaceID: "ws", Content: "ask", Now: now,
	})
	if err != nil {
		t.Fatal(err)
	}
	batch := []ChatEvent{
		{ChatAttemptID: send.ChatAttemptID, Seq: 1, EventKind: "progress", Payload: []byte(`{"text":"a"}`), RecordedAt: now},
		{ChatAttemptID: send.ChatAttemptID, Seq: 2, EventKind: "progress", Payload: []byte(`{"text":"b"}`), RecordedAt: now.Add(time.Millisecond)},
	}
	if err := AppendEventBatch(ctx, db, send.ChatAttemptID, batch); err != nil {
		t.Fatal(err)
	}
	if err := AppendEventBatch(ctx, db, send.ChatAttemptID, batch); err != nil {
		t.Fatalf("duplicate batch: %v", err)
	}
	conflict := []ChatEvent{{ChatAttemptID: send.ChatAttemptID, Seq: 1, EventKind: "progress", Payload: []byte(`{"text":"other"}`), RecordedAt: now}}
	if err := AppendEventBatch(ctx, db, send.ChatAttemptID, conflict); err == nil {
		t.Fatal("conflicting event payload accepted")
	}
	oversized := make([]ChatEvent, maxEventBatch+1)
	for i := range oversized {
		oversized[i] = ChatEvent{ChatAttemptID: send.ChatAttemptID, Seq: i + 10, EventKind: "progress", RecordedAt: now}
	}
	if err := AppendEventBatch(ctx, db, send.ChatAttemptID, oversized); err == nil {
		t.Fatal("oversized batch accepted")
	}
	events, err := ListEventsAfter(ctx, db, send.ChatAttemptID, 0, 10)
	if err != nil || len(events) != 2 || events[0].Seq != 1 || events[1].Seq != 2 {
		t.Fatalf("events after 0 = %+v err=%v", events, err)
	}
	tail, err := ListEventsAfter(ctx, db, send.ChatAttemptID, 1, 10)
	if err != nil || len(tail) != 1 || tail[0].Seq != 2 {
		t.Fatalf("events after 1 = %+v err=%v", tail, err)
	}
}

func TestCompleteAttemptTerminalOnceAndRestart(t *testing.T) {
	ctx := context.Background()
	db, root := openChatDB(t)
	now := time.Date(2026, 8, 25, 14, 0, 0, 0, time.UTC)
	send, err := SendTurn(ctx, db, SendTurnInput{
		CommandID: "cmd-c", SessionID: "s-c", WorkspaceID: "ws", Content: "q", Now: now,
	})
	if err != nil {
		t.Fatal(err)
	}
	done, err := CompleteAttempt(ctx, db, CompleteAttemptInput{
		CommandID: "cmd-done", ChatAttemptID: send.ChatAttemptID, Content: "answer", Outcome: "succeeded", Now: now.Add(time.Second),
	})
	if err != nil {
		t.Fatal(err)
	}
	if done.Status != "succeeded" || done.TurnSeq != 2 {
		t.Fatalf("complete = %+v", done)
	}
	replay, err := CompleteAttempt(ctx, db, CompleteAttemptInput{
		CommandID: "cmd-done", ChatAttemptID: send.ChatAttemptID, Content: "answer", Outcome: "succeeded", Now: now.Add(time.Second),
	})
	if err != nil {
		t.Fatal(err)
	}
	if replay != done {
		t.Fatalf("complete replay = %+v want %+v", replay, done)
	}
	if _, err := CompleteAttempt(ctx, db, CompleteAttemptInput{
		CommandID: "cmd-done-2", ChatAttemptID: send.ChatAttemptID, Content: "nope", Outcome: "failed", Now: now.Add(2 * time.Second),
	}); err == nil {
		t.Fatal("second terminal outcome accepted")
	}
	active, err := GetActiveAttempt(ctx, db, "s-c")
	if err != nil || active != nil {
		t.Fatalf("active after terminal = %+v err=%v", active, err)
	}
	turns, err := ListTurnsAfter(ctx, db, "s-c", 0, 10)
	if err != nil || len(turns) != 2 || turns[1].OutcomeStatus == nil || *turns[1].OutcomeStatus != "succeeded" {
		t.Fatalf("turns = %+v err=%v", turns, err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	db, err = Open(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	after, err := CompleteAttempt(ctx, db, CompleteAttemptInput{
		CommandID: "cmd-done", ChatAttemptID: send.ChatAttemptID, Content: "answer", Outcome: "succeeded", Now: now.Add(time.Second),
	})
	if err != nil || after != done {
		t.Fatalf("restart complete replay = %+v err=%v", after, err)
	}
}

func TestCheckpointPinLoadCompareAndClear(t *testing.T) {
	ctx := context.Background()
	db, _ := openChatDB(t)
	defer db.Close()
	now := time.Date(2026, 8, 25, 15, 0, 0, 0, time.UTC)
	send, err := SendTurn(ctx, db, SendTurnInput{
		CommandID: "cmd-cp", SessionID: "s-cp", WorkspaceID: "ws", Content: "q", BuilderPolicy: "claude", Now: now,
	})
	if err != nil {
		t.Fatal(err)
	}
	attemptID := send.ChatAttemptID
	if err := PinCheckpoint(ctx, db, RuntimeCheckpoint{
		SessionID: "s-cp", BuilderID: "claude", RuntimeProfile: "default",
		ProviderCheckpointRef: "ckpt-1", WorkdirRef: "wt-1", OwningAttemptID: &attemptID,
		LeaseGeneration: 3, PinnedAt: now,
	}); err != nil {
		t.Fatal(err)
	}
	loaded, err := LoadCompatibleCheckpoint(ctx, db, "s-cp", "claude", "default")
	if err != nil || loaded == nil || loaded.ProviderCheckpointRef != "ckpt-1" || !loaded.Valid {
		t.Fatalf("load = %+v err=%v", loaded, err)
	}
	cleared, err := CompareAndClearCheckpoint(ctx, db, "s-cp", "claude", "default", attemptID, 2, now.Add(time.Second))
	if err != nil || cleared {
		t.Fatalf("mismatched clear succeeded: cleared=%v err=%v", cleared, err)
	}
	still, err := LoadCompatibleCheckpoint(ctx, db, "s-cp", "claude", "default")
	if err != nil || still == nil || !still.Valid {
		t.Fatalf("checkpoint erased by mismatch: %+v err=%v", still, err)
	}
	cleared, err = CompareAndClearCheckpoint(ctx, db, "s-cp", "claude", "default", attemptID, 3, now.Add(2*time.Second))
	if err != nil || !cleared {
		t.Fatalf("exact clear failed: cleared=%v err=%v", cleared, err)
	}
	gone, err := LoadCompatibleCheckpoint(ctx, db, "s-cp", "claude", "default")
	if err != nil || gone != nil {
		t.Fatalf("expected cleared checkpoint nil, got %+v err=%v", gone, err)
	}
}

func TestChatMigrationSQLMirrorExists(t *testing.T) {
	path := filepath.Join("..", "..", "..", "migrations", "000003_sen_chat_durability.sql")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("migration mirror missing: %v", err)
	}
}
