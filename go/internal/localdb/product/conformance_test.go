package product

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestAO14SchemaPragmasAndChecks(t *testing.T) {
	db, err := Open(context.Background(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	pragmas := map[string]string{
		"journal_mode": "wal", "synchronous": "2", "foreign_keys": "1",
		"busy_timeout": "5000", "cache_size": "-64000", "temp_store": "2",
	}
	for pragma, want := range pragmas {
		var got string
		if err := db.QueryRow("PRAGMA " + pragma).Scan(&got); err != nil || got != want {
			t.Fatalf("PRAGMA %s = %q, want %q, error = %v", pragma, got, want, err)
		}
	}

	wantColumns := map[string][]string{
		"schema_migrations": {"version", "applied_at"},
		"sen_messages":      {"id", "session_id", "role", "content", "metadata", "created_at"},
		"run_refs":          {"run_id", "goal_id", "status", "outcome", "summary", "started_at", "ended_at", "metadata", "synced_at"},
		"command_receipts":  {"command_id", "command_type", "actor_id", "status", "payload", "result", "error", "executed_at"},
		"export_candidates": {"id", "source_type", "source_id", "export_format", "content_hash", "status", "created_at", "exported_at"},
	}
	for table, want := range wantColumns {
		rows, err := db.Query("PRAGMA table_info(" + table + ")")
		if err != nil {
			t.Fatal(err)
		}
		var got []string
		for rows.Next() {
			var cid, notNull, primaryKey int
			var name, kind string
			var defaultValue any
			if err := rows.Scan(&cid, &name, &kind, &notNull, &defaultValue, &primaryKey); err != nil {
				t.Fatal(err)
			}
			got = append(got, name)
		}
		rows.Close()
		if fmt.Sprint(got) != fmt.Sprint(want) {
			t.Fatalf("%s columns = %v, want %v", table, got, want)
		}
	}
	for _, index := range []string{"idx_sen_messages_session", "idx_run_refs_goal", "idx_export_status"} {
		var count int
		if err := db.QueryRow("SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name=?", index).Scan(&count); err != nil || count != 1 {
			t.Fatalf("index %s count = %d, error = %v", index, count, err)
		}
	}
	if _, err := db.Exec(`INSERT INTO sen_messages VALUES ('bad','s','tool','x',NULL,'2026-08-25T00:00:00.000Z')`); err == nil {
		t.Fatal("role CHECK accepted tool")
	}
	if _, err := db.Exec(`INSERT INTO export_candidates VALUES ('bad','x','x','json','h','copying','2026-08-25T00:00:00.000Z',NULL)`); err == nil {
		t.Fatal("status CHECK accepted copying")
	}
	if _, err := db.Exec(`INSERT INTO sen_messages VALUES ('bad-time','s','user','x',NULL,'2026-08-25 00:00:00')`); err == nil {
		t.Fatal("timestamp CHECK accepted non-RFC3339 value")
	}
}

func TestReceiptsCandidatesReplayRetentionAndRFC3339(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	db, err := Open(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 8, 25, 4, 5, 6, 123456789, time.FixedZone("west", -7*3600))
	receipt := CommandReceipt{CommandID: "command-1", CommandType: "create", ActorID: "actor-1", Status: "completed", Payload: []byte(`{"a":1}`), Result: []byte(`{"ok":true}`), ExecutedAt: now}
	if err := PutCommandReceipt(ctx, db, receipt); err != nil {
		t.Fatal(err)
	}
	if err := PutCommandReceipt(ctx, db, receipt); err != nil {
		t.Fatalf("idempotent receipt replay: %v", err)
	}
	conflict := receipt
	conflict.Status = "failed"
	if err := PutCommandReceipt(ctx, db, conflict); err == nil {
		t.Fatal("conflicting receipt replay accepted")
	}

	pending := ExportCandidate{ID: "pending", SourceType: "message", SourceID: "m1", ExportFormat: "json", ContentHash: "hash-1", Status: "pending", CreatedAt: now}
	terminal := ExportCandidate{ID: "exported", SourceType: "message", SourceID: "m2", ExportFormat: "json", ContentHash: "hash-2", Status: "pending", CreatedAt: now.Add(-time.Hour)}
	for _, candidate := range []ExportCandidate{pending, terminal} {
		if err := PutExportCandidate(ctx, db, candidate); err != nil {
			t.Fatal(err)
		}
		if err := PutExportCandidate(ctx, db, candidate); err != nil {
			t.Fatalf("idempotent candidate replay: %v", err)
		}
	}
	if err := AcknowledgeExportCandidate(ctx, db, acknowledgement(terminal, "exported", &now)); err != nil {
		t.Fatal(err)
	}
	deleted, err := CleanupExportCandidates(ctx, db, now.Add(time.Minute), 10)
	if err != nil || deleted != 1 {
		t.Fatalf("cleanup deleted %d, error = %v", deleted, err)
	}
	candidates, err := ListPendingExportCandidates(ctx, db, 10)
	if err != nil || len(candidates) != 1 || candidates[0].ID != "pending" {
		t.Fatalf("pending replay = %+v, error = %v", candidates, err)
	}
	var executedAt string
	if err := db.QueryRow("SELECT executed_at FROM command_receipts WHERE command_id='command-1'").Scan(&executedAt); err != nil {
		t.Fatal(err)
	}
	if executedAt != "2026-08-25T11:05:06.123Z" {
		t.Fatalf("executed_at = %q", executedAt)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	db, err = Open(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := PutCommandReceipt(ctx, db, receipt); err != nil {
		t.Fatalf("receipt replay after restart: %v", err)
	}
	candidates, err = ListPendingExportCandidates(ctx, db, 10)
	if err != nil || len(candidates) != 1 {
		t.Fatalf("candidate replay after restart = %+v, error = %v", candidates, err)
	}
}

func TestConcurrentWritersWaitWithinBusyTimeout(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	first, err := Open(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	second, err := Open(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()

	tx, err := first.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec("INSERT INTO sen_messages VALUES ('first','s','user','x',NULL,'2026-08-25T00:00:00.000Z')"); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	wg.Add(1)
	errCh := make(chan error, 1)
	go func() {
		defer wg.Done()
		errCh <- PutMessage(ctx, second, Message{ID: "second", SessionID: "s", Role: "assistant", Content: "y", CreatedAt: time.Now()})
	}()
	time.Sleep(100 * time.Millisecond)
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	wg.Wait()
	if err := <-errCh; err != nil {
		t.Fatalf("writer did not wait within busy_timeout: %v", err)
	}
	var count int
	if err := first.QueryRow("SELECT COUNT(*) FROM sen_messages").Scan(&count); err != nil || count != 2 {
		t.Fatalf("message count = %d, error = %v", count, err)
	}
}

func TestDatabaseFilename(t *testing.T) {
	root := t.TempDir()
	db, err := Open(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	db.Close()
	if _, err := os.Stat(filepath.Join(root, DatabaseName)); err != nil {
		t.Fatal(err)
	}
}
