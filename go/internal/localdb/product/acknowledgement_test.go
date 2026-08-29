package product

import (
	"context"
	"database/sql"
	"fmt"
	"sync"
	"testing"
	"time"
)

func pendingCandidate(id string, now time.Time) ExportCandidate {
	return ExportCandidate{
		ID: id, SourceType: "message", SourceID: "message-1", ExportFormat: "json",
		ContentHash: "sha256:one", Status: "pending", CreatedAt: now,
	}
}

func acknowledgement(candidate ExportCandidate, status string, exportedAt *time.Time) ExportAcknowledgement {
	return ExportAcknowledgement{
		ID: candidate.ID, SourceType: candidate.SourceType, SourceID: candidate.SourceID,
		ExportFormat: candidate.ExportFormat, ContentHash: candidate.ContentHash,
		Status: status, ExportedAt: exportedAt,
	}
}

func TestAcknowledgeExportCandidateTransitionsAndRetries(t *testing.T) {
	ctx := context.Background()
	db, err := Open(ctx, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.Date(2026, 8, 25, 4, 5, 6, 987654321, time.FixedZone("west", -7*3600))

	for _, status := range []string{"exported", "failed", "quarantined"} {
		candidate := pendingCandidate(status, now)
		if err := PutExportCandidate(ctx, db, candidate); err != nil {
			t.Fatal(err)
		}
		var exportedAt *time.Time
		if status == "exported" {
			exportedAt = &now
		}
		ack := acknowledgement(candidate, status, exportedAt)
		if err := AcknowledgeExportCandidate(ctx, db, ack); err != nil {
			t.Fatalf("%s acknowledgement: %v", status, err)
		}
		if err := AcknowledgeExportCandidate(ctx, db, ack); err != nil {
			t.Fatalf("%s identical retry: %v", status, err)
		}
		var gotStatus string
		var gotExported sql.NullString
		if err := db.QueryRow("SELECT status, exported_at FROM export_candidates WHERE id=?", candidate.ID).Scan(&gotStatus, &gotExported); err != nil {
			t.Fatal(err)
		}
		if gotStatus != status {
			t.Fatalf("status = %q, want %q", gotStatus, status)
		}
		if status == "exported" && (!gotExported.Valid || gotExported.String != "2026-08-25T11:05:06.987Z") {
			t.Fatalf("exported_at = %+v", gotExported)
		}
		if status != "exported" && gotExported.Valid {
			t.Fatalf("%s exported_at must be null: %+v", status, gotExported)
		}
	}
}

func TestAcknowledgeExportCandidateRejectsInvalidAndConflictingRequests(t *testing.T) {
	ctx := context.Background()
	db, err := Open(ctx, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)
	candidate := pendingCandidate("candidate", now)
	if err := PutExportCandidate(ctx, db, candidate); err != nil {
		t.Fatal(err)
	}

	invalid := []ExportAcknowledgement{
		{},
		acknowledgement(candidate, "pending", nil),
		acknowledgement(candidate, "unknown", nil),
		acknowledgement(candidate, "exported", nil),
		acknowledgement(candidate, "failed", &now),
		acknowledgement(candidate, "quarantined", &now),
	}
	for i, ack := range invalid {
		if err := AcknowledgeExportCandidate(ctx, db, ack); err == nil {
			t.Fatalf("invalid acknowledgement %d accepted: %+v", i, ack)
		}
	}
	if err := AcknowledgeExportCandidate(ctx, nil, acknowledgement(candidate, "failed", nil)); err == nil {
		t.Fatal("nil database accepted")
	}
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	if err := AcknowledgeExportCandidate(canceled, db, acknowledgement(candidate, "failed", nil)); err == nil {
		t.Fatal("canceled context accepted")
	}
	missing := acknowledgement(candidate, "failed", nil)
	missing.ID = "missing"
	if err := AcknowledgeExportCandidate(ctx, db, missing); err == nil {
		t.Fatal("missing candidate accepted")
	}

	exportedAt := now.Add(time.Hour)
	exported := acknowledgement(candidate, "exported", &exportedAt)
	if err := AcknowledgeExportCandidate(ctx, db, exported); err != nil {
		t.Fatal(err)
	}
	conflicts := []ExportAcknowledgement{
		acknowledgement(candidate, "failed", nil),
		acknowledgement(candidate, "quarantined", nil),
		acknowledgement(candidate, "exported", &now),
		exported,
		exported,
		exported,
		exported,
	}
	conflicts[3].SourceType = "run"
	conflicts[4].SourceID = "other"
	conflicts[5].ExportFormat = "yaml"
	conflicts[6].ContentHash = "sha256:other"
	for i, ack := range conflicts {
		if err := AcknowledgeExportCandidate(ctx, db, ack); err == nil {
			t.Fatalf("conflicting retry %d accepted: %+v", i, ack)
		}
	}
}

func TestAcknowledgeExportCandidateConcurrentWriters(t *testing.T) {
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
	now := time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)
	candidate := pendingCandidate("race", now)
	if err := PutExportCandidate(ctx, first, candidate); err != nil {
		t.Fatal(err)
	}

	start := make(chan struct{})
	var wg sync.WaitGroup
	errors := make(chan error, 2)
	for i, item := range []struct {
		db     *sql.DB
		status string
	}{{first, "failed"}, {second, "quarantined"}} {
		wg.Add(1)
		go func(index int, db *sql.DB, status string) {
			defer wg.Done()
			<-start
			errors <- AcknowledgeExportCandidate(ctx, db, acknowledgement(candidate, status, nil))
		}(i, item.db, item.status)
	}
	close(start)
	wg.Wait()
	close(errors)
	succeeded := 0
	for err := range errors {
		if err == nil {
			succeeded++
		}
	}
	if succeeded != 1 {
		t.Fatalf("concurrent acknowledgement successes = %d, want 1", succeeded)
	}
	var status string
	if err := first.QueryRow("SELECT status FROM export_candidates WHERE id='race'").Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "failed" && status != "quarantined" {
		t.Fatalf("terminal status = %q", status)
	}
}

func TestAcknowledgeExportCandidateCrashWindowAndRestartReplay(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	db, err := Open(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)
	candidate := pendingCandidate("crash-window", now)
	if err := PutExportCandidate(ctx, db, candidate); err != nil {
		t.Fatal(err)
	}

	// Community enqueue is external and idempotent by stable candidate ID/hash.
	// Simulated success and process crash leave product pending for replay.
	communityEnqueues := map[string]string{}
	enqueue := func(id, hash string) error {
		if existing, ok := communityEnqueues[id]; ok && existing != hash {
			return fmt.Errorf("community conflict")
		}
		communityEnqueues[id] = hash
		return nil
	}
	if err := enqueue(candidate.ID, candidate.ContentHash); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	db, err = Open(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	if err := enqueue(candidate.ID, candidate.ContentHash); err != nil {
		t.Fatalf("idempotent community retry: %v", err)
	}
	pending, err := ListPendingExportCandidates(ctx, db, 10)
	if err != nil || len(pending) != 1 || pending[0].ID != candidate.ID {
		t.Fatalf("pending replay = %+v, error = %v", pending, err)
	}
	ack := acknowledgement(candidate, "exported", &now)
	if err := AcknowledgeExportCandidate(ctx, db, ack); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	db, err = Open(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := AcknowledgeExportCandidate(ctx, db, ack); err != nil {
		t.Fatalf("terminal replay after restart: %v", err)
	}
	pending, err = ListPendingExportCandidates(ctx, db, 10)
	if err != nil || len(pending) != 0 {
		t.Fatalf("terminal candidate replayed as pending: %+v, %v", pending, err)
	}
}

func TestPutExportCandidateRequiresPendingWithoutExportedAt(t *testing.T) {
	ctx := context.Background()
	db, err := Open(ctx, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)
	candidate := pendingCandidate("put-rules", now)
	candidate.Status = "exported"
	candidate.ExportedAt = &now
	if err := PutExportCandidate(ctx, db, candidate); err == nil {
		t.Fatal("terminal candidate inserted without acknowledgement")
	}
	candidate.Status = "pending"
	if err := PutExportCandidate(ctx, db, candidate); err == nil {
		t.Fatal("pending candidate with exported_at accepted")
	}
}

func TestExportCandidateTriggersPreventDirectMutation(t *testing.T) {
	ctx := context.Background()
	db, err := Open(ctx, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)
	candidate := pendingCandidate("triggers", now)
	if err := PutExportCandidate(ctx, db, candidate); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO export_candidates VALUES ('terminal-insert','message','m','json','h','failed','2026-08-25T12:00:00.000Z',NULL)"); err == nil {
		t.Fatal("direct terminal candidate insertion accepted")
	}
	if _, err := db.Exec("UPDATE export_candidates SET content_hash='changed' WHERE id='triggers'"); err == nil {
		t.Fatal("direct immutable field mutation accepted")
	}
	if _, err := db.Exec("UPDATE export_candidates SET status='exported' WHERE id='triggers'"); err == nil {
		t.Fatal("export without timestamp accepted")
	}
	if _, err := db.Exec("UPDATE export_candidates SET status='failed', exported_at='2026-08-25T12:00:00.000Z' WHERE id='triggers'"); err == nil {
		t.Fatal("failed with exported_at accepted")
	}
	if _, err := db.Exec("UPDATE export_candidates SET status='failed' WHERE id='triggers'"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("UPDATE export_candidates SET status='pending' WHERE id='triggers'"); err == nil {
		t.Fatal("terminal to pending transition accepted")
	}
	if _, err := db.Exec("UPDATE export_candidates SET status='quarantined' WHERE id='triggers'"); err == nil {
		t.Fatal("terminal to terminal transition accepted")
	}
}
