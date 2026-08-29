package handoff

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"agentic-os/internal/localdb/community"
	"agentic-os/internal/localdb/product"
)

func setupTestDBs(t *testing.T) (*sql.DB, *community.SQLiteCommunityStore, string, string) {
	t.Helper()
	ctx := context.Background()
	tempDir := t.TempDir()

	prodDir := filepath.Join(tempDir, "product")
	commPath := filepath.Join(tempDir, "community", "community-queue.db")

	prodDB, err := product.Open(ctx, prodDir)
	if err != nil {
		t.Fatalf("failed to open product db: %v", err)
	}

	commStore, err := community.OpenSQLiteCommunityStore(ctx, commPath)
	if err != nil {
		prodDB.Close()
		t.Fatalf("failed to open community store: %v", err)
	}

	return prodDB, commStore, prodDir, commPath
}

func makeCandidate(id string, now time.Time) product.ExportCandidate {
	return product.ExportCandidate{
		ID:           id,
		SourceType:   "message",
		SourceID:     "msg-" + id,
		ExportFormat: "json",
		ContentHash:  "sha256:hash-" + id,
		Status:       "pending",
		CreatedAt:    now,
	}
}

// TestHandoff_DurableAcceptedResultVerifiesExport tests clean accepted handoff.
func TestHandoff_DurableAcceptedResultVerifiesExport(t *testing.T) {
	ctx := context.Background()
	prodDB, commStore, _, _ := setupTestDBs(t)
	defer prodDB.Close()
	defer commStore.Close()

	now := time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)
	cand := makeCandidate("cand-accepted", now)
	if err := product.PutExportCandidate(ctx, prodDB, cand); err != nil {
		t.Fatal(err)
	}

	payload := HandoffPayload{
		RawPayload: `{"text":"hello world","clean":"data"}`,
		Metadata:   map[string]string{"tag": "public-tag"},
	}

	res, err := IngestAndAcknowledge(ctx, prodDB, commStore, cand, payload)
	if err != nil {
		t.Fatalf("IngestAndAcknowledge failed: %v", err)
	}
	if res.Status != "exported" {
		t.Fatalf("expected status 'exported', got %q", res.Status)
	}

	// Verify Community store state
	item, err := commStore.Get(ctx, cand.ID)
	if err != nil || item == nil {
		t.Fatalf("community item missing: %v", err)
	}
	if item.Status != community.StatusPending {
		t.Fatalf("expected community status 'pending', got %q", item.Status)
	}
	if item.QuarantineReason != nil {
		t.Fatalf("expected no quarantine reason, got %v", *item.QuarantineReason)
	}

	// Verify Product DB state
	var status string
	var exportedAt sql.NullString
	err = prodDB.QueryRow("SELECT status, exported_at FROM export_candidates WHERE id = ?", cand.ID).Scan(&status, &exportedAt)
	if err != nil {
		t.Fatal(err)
	}
	if status != "exported" {
		t.Fatalf("product status = %q, want 'exported'", status)
	}
	if !exportedAt.Valid || exportedAt.String == "" {
		t.Fatalf("exported_at was not set: %+v", exportedAt)
	}

	// Verify no pending items left in product outbox
	pending, err := product.ListPendingExportCandidates(ctx, prodDB, 10)
	if err != nil || len(pending) != 0 {
		t.Fatalf("expected 0 pending, got %d (err: %v)", len(pending), err)
	}
}

// TestHandoff_ForbiddenQuarantineAcknowledgesQuarantined tests that sensitive payloads are quarantined without queue disruption.
func TestHandoff_ForbiddenQuarantineAcknowledgesQuarantined(t *testing.T) {
	ctx := context.Background()
	prodDB, commStore, _, _ := setupTestDBs(t)
	defer prodDB.Close()
	defer commStore.Close()

	now := time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)
	cand := makeCandidate("cand-quarantine", now)
	if err := product.PutExportCandidate(ctx, prodDB, cand); err != nil {
		t.Fatal(err)
	}

	// Contains secret token (aws key pattern)
	payload := HandoffPayload{
		RawPayload: `{"secret":"AKIAIOSFODNN7EXAMPLE"}`,
		Metadata:   map[string]string{"env": "prod"},
	}

	res, err := IngestAndAcknowledge(ctx, prodDB, commStore, cand, payload)
	if err != nil {
		t.Fatalf("IngestAndAcknowledge failed: %v", err)
	}
	if res.Status != "quarantined" {
		t.Fatalf("expected status 'quarantined', got %q", res.Status)
	}

	// Community store must have quarantined item
	item, err := commStore.Get(ctx, cand.ID)
	if err != nil || item == nil {
		t.Fatalf("community item missing: %v", err)
	}
	if item.Status != community.StatusQuarantined {
		t.Fatalf("expected community status 'quarantined', got %q", item.Status)
	}
	if item.QuarantineReason == nil {
		t.Fatal("expected quarantine reason to be set")
	}

	// Product DB must be acknowledged as quarantined (with exported_at = NULL)
	var status string
	var exportedAt sql.NullString
	err = prodDB.QueryRow("SELECT status, exported_at FROM export_candidates WHERE id = ?", cand.ID).Scan(&status, &exportedAt)
	if err != nil {
		t.Fatal(err)
	}
	if status != "quarantined" {
		t.Fatalf("product status = %q, want 'quarantined'", status)
	}
	if exportedAt.Valid {
		t.Fatalf("quarantined candidate must have NULL exported_at: %+v", exportedAt)
	}
}

// TestHandoff_QueueFailureLeavesProductPending verifies that community outages keep product candidate pending.
func TestHandoff_QueueFailureLeavesProductPending(t *testing.T) {
	ctx := context.Background()
	prodDB, commStore, _, _ := setupTestDBs(t)
	defer prodDB.Close()

	now := time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)
	cand := makeCandidate("cand-outage", now)
	if err := product.PutExportCandidate(ctx, prodDB, cand); err != nil {
		t.Fatal(err)
	}

	// Close community store to simulate outage / failure
	commStore.Close()

	payload := HandoffPayload{RawPayload: `{"text":"test"}`}
	res, err := IngestAndAcknowledge(ctx, prodDB, commStore, cand, payload)
	if err == nil {
		t.Fatal("expected error on closed community DB, got nil")
	}
	if res != nil {
		t.Fatalf("expected nil result on failure, got %+v", res)
	}

	// Product candidate must still be pending
	var status string
	err = prodDB.QueryRow("SELECT status FROM export_candidates WHERE id = ?", cand.ID).Scan(&status)
	if err != nil {
		t.Fatal(err)
	}
	if status != "pending" {
		t.Fatalf("product status = %q, want 'pending'", status)
	}

	pending, err := product.ListPendingExportCandidates(ctx, prodDB, 10)
	if err != nil || len(pending) != 1 || pending[0].ID != cand.ID {
		t.Fatalf("expected candidate to remain pending in outbox: %+v", pending)
	}
}

// TestHandoff_CrashAfterEnqueueBeforeAckReplaysIdempotently simulates crash after community enqueue but before product ack.
func TestHandoff_CrashAfterEnqueueBeforeAckReplaysIdempotently(t *testing.T) {
	ctx := context.Background()
	prodDB, commStore, prodDir, commPath := setupTestDBs(t)
	now := time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)
	cand := makeCandidate("cand-crash", now)
	if err := product.PutExportCandidate(ctx, prodDB, cand); err != nil {
		t.Fatal(err)
	}

	payload := HandoffPayload{RawPayload: `{"data":"val"}`}

	// Step 1: Enqueue directly into community queue (simulating partial execution before crash)
	prodCand := community.ProductExportCandidate{
		ID:           cand.ID,
		SourceType:   cand.SourceType,
		SourceID:     cand.SourceID,
		ExportFormat: cand.ExportFormat,
		ContentHash:  cand.ContentHash,
		Status:       cand.Status,
		RawPayload:   payload.RawPayload,
		Metadata:     payload.Metadata,
		CreatedAt:    cand.CreatedAt,
	}
	item, err := commStore.IngestExportCandidate(ctx, prodCand)
	if err != nil {
		t.Fatal(err)
	}
	if item == nil {
		t.Fatal("expected non-nil item")
	}

	// Simulate crash: Close both DB connections without acknowledging in product DB
	prodDB.Close()
	commStore.Close()

	// Restart: Re-open both DBs
	prodDB, err = product.Open(ctx, prodDir)
	if err != nil {
		t.Fatal(err)
	}
	defer prodDB.Close()

	commStore, err = community.OpenSQLiteCommunityStore(ctx, commPath)
	if err != nil {
		t.Fatal(err)
	}
	defer commStore.Close()

	// Verify candidate is still pending in product DB
	pending, err := product.ListPendingExportCandidates(ctx, prodDB, 10)
	if err != nil || len(pending) != 1 || pending[0].ID != cand.ID {
		t.Fatalf("expected candidate to still be pending after restart: %+v", pending)
	}

	// Step 2: Replay bridge execution
	res, err := IngestAndAcknowledge(ctx, prodDB, commStore, cand, payload)
	if err != nil {
		t.Fatalf("replay IngestAndAcknowledge failed: %v", err)
	}
	if res.Status != "exported" {
		t.Fatalf("status = %q, want 'exported'", res.Status)
	}

	// Verify both DBs are in consistent terminal state
	var status string
	if err := prodDB.QueryRow("SELECT status FROM export_candidates WHERE id = ?", cand.ID).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "exported" {
		t.Fatalf("product status = %q, want 'exported'", status)
	}

	// Repeating the exact call once more must also succeed idempotently
	res2, err := IngestAndAcknowledge(ctx, prodDB, commStore, cand, payload)
	if err != nil {
		t.Fatalf("subsequent replay failed: %v", err)
	}
	if res2.Status != "exported" {
		t.Fatalf("status = %q, want 'exported'", res2.Status)
	}
}

// TestHandoff_ExactlyTwoDBIdentities verifies product and community databases maintain distinct separate files and schemas.
func TestHandoff_ExactlyTwoDBIdentities(t *testing.T) {
	prodDB, commStore, prodDir, commPath := setupTestDBs(t)
	defer prodDB.Close()
	defer commStore.Close()

	// Verify separate paths
	prodDBPath := filepath.Join(prodDir, product.DatabaseName)
	if prodDBPath == commPath {
		t.Fatalf("product DB path and community DB path must be distinct: %s vs %s", prodDBPath, commPath)
	}

	// Verify product DB has export_candidates and sen_messages
	var count int
	if err := prodDB.QueryRow("SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('export_candidates', 'sen_messages', 'command_receipts')").Scan(&count); err != nil || count != 3 {
		t.Fatalf("expected 3 product tables, got %d (err: %v)", count, err)
	}

	// Verify community DB has sanitized_contributions and delivery_attempts
	if err := commStore.DB().QueryRow("SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('sanitized_contributions', 'delivery_attempts', 'publication_receipts')").Scan(&count); err != nil || count != 3 {
		t.Fatalf("expected 3 community tables, got %d (err: %v)", count, err)
	}
}

// TestHandoff_ConcurrentCalls verifies thread-safety when multiple bridge operations run concurrently.
func TestHandoff_ConcurrentCalls(t *testing.T) {
	ctx := context.Background()
	prodDB, commStore, _, _ := setupTestDBs(t)
	defer prodDB.Close()
	defer commStore.Close()

	now := time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)
	const count = 20

	var candidates []product.ExportCandidate
	for i := range count {
		cand := makeCandidate(fmt.Sprintf("cand-conc-%02d", i), now.Add(time.Duration(i)*time.Second))
		if err := product.PutExportCandidate(ctx, prodDB, cand); err != nil {
			t.Fatal(err)
		}
		candidates = append(candidates, cand)
	}

	var wg sync.WaitGroup
	errs := make(chan error, count)

	for i := range candidates {
		wg.Add(1)
		go func(cand product.ExportCandidate, idx int) {
			defer wg.Done()
			payload := HandoffPayload{
				RawPayload: fmt.Sprintf(`{"msg":"item %d"}`, idx),
				Metadata:   map[string]string{"tag": "clean"},
			}
			if idx%4 == 0 {
				// Inject quarantine payload for some
				payload.RawPayload = `{"secret":"AKIAIOSFODNN7EXAMPLE"}`
			}
			_, err := IngestAndAcknowledge(ctx, prodDB, commStore, cand, payload)
			if err != nil {
				errs <- fmt.Errorf("cand %s: %w", cand.ID, err)
			}
		}(candidates[i], i)
	}

	wg.Wait()
	close(errs)

	for err := range errs {
		t.Errorf("concurrent execution error: %v", err)
	}

	// Verify all candidates are in terminal state
	pending, err := product.ListPendingExportCandidates(ctx, prodDB, count*2)
	if err != nil {
		t.Fatal(err)
	}
	if len(pending) != 0 {
		t.Fatalf("expected 0 pending candidates remaining, got %d", len(pending))
	}
}

// TestHandoff_ProcessPendingBridgeBatch verifies batch helper.
func TestHandoff_ProcessPendingBridgeBatch(t *testing.T) {
	ctx := context.Background()
	prodDB, commStore, _, _ := setupTestDBs(t)
	defer prodDB.Close()
	defer commStore.Close()

	now := time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)
	const total = 5
	for i := range total {
		cand := makeCandidate(fmt.Sprintf("cand-batch-%02d", i), now.Add(time.Duration(i)*time.Minute))
		if err := product.PutExportCandidate(ctx, prodDB, cand); err != nil {
			t.Fatal(err)
		}
	}

	results, err := ProcessPendingBridge(ctx, prodDB, commStore, total, func(c product.ExportCandidate) HandoffPayload {
		return HandoffPayload{RawPayload: fmt.Sprintf(`{"id":%q}`, c.ID)}
	})
	if err != nil {
		t.Fatalf("ProcessPendingBridge failed: %v", err)
	}
	if len(results) != total {
		t.Fatalf("expected %d results, got %d", total, len(results))
	}

	// Verify zero pending remaining
	pending, err := product.ListPendingExportCandidates(ctx, prodDB, 10)
	if err != nil || len(pending) != 0 {
		t.Fatalf("expected 0 pending, got %d (%v)", len(pending), err)
	}
}

// TestMaterializeGateDatabases generates producer-verified real SQLite database files
// for final gate inspection when S02_GATE_DB_DIR is set.
// It requires an empty target directory, creates exactly sen-product.db and community-queue.db
// via production Open APIs, executes a clean handoff + durable receipt/watermark/removal setup,
// checkpoints and closes cleanly, leaving files for external read-only gate evaluation.
func TestMaterializeGateDatabases(t *testing.T) {
	gateDir := os.Getenv("S02_GATE_DB_DIR")
	if gateDir == "" {
		t.Skip("S02_GATE_DB_DIR not set; skipping gate database materialization")
	}

	gateDir, err := filepath.Abs(gateDir)
	if err != nil {
		t.Fatalf("failed to resolve S02_GATE_DB_DIR: %v", err)
	}

	// Target directory must exist and be empty
	entries, err := os.ReadDir(gateDir)
	if err != nil {
		if os.IsNotExist(err) {
			if err := os.MkdirAll(gateDir, 0755); err != nil {
				t.Fatalf("failed to create gate dir: %v", err)
			}
		} else {
			t.Fatalf("failed to read gate dir %q: %v", gateDir, err)
		}
	} else if len(entries) > 0 {
		t.Fatalf("target directory %q must be empty, found %d existing entries", gateDir, len(entries))
	}

	ctx := context.Background()

	// 1. Open both DBs via production Open APIs directly in the target directory
	prodDB, err := product.Open(ctx, gateDir)
	if err != nil {
		t.Fatalf("failed to open product db in %q: %v", gateDir, err)
	}

	commPath := filepath.Join(gateDir, "community-queue.db")
	commStore, err := community.OpenSQLiteCommunityStore(ctx, commPath)
	if err != nil {
		prodDB.Close()
		t.Fatalf("failed to open community store at %q: %v", commPath, err)
	}

	now := time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)

	// 2. Populate product message and receipt
	msg := product.Message{
		ID:        "msg-gate-001",
		SessionID: "session-gate-001",
		Role:      "user",
		Content:   "Gate evaluation test input",
		CreatedAt: now,
	}
	if err := product.PutMessage(ctx, prodDB, msg); err != nil {
		prodDB.Close()
		commStore.Close()
		t.Fatalf("failed to put product message: %v", err)
	}

	receipt := product.CommandReceipt{
		CommandID:   "cmd-gate-001",
		CommandType: "ingest_export",
		ActorID:     "actor-gate-001",
		Status:      "succeeded",
		Payload:     []byte(`{"command":"export"}`),
		Result:      []byte(`{"status":"ok"}`),
		ExecutedAt:  now,
	}
	if err := product.PutCommandReceipt(ctx, prodDB, receipt); err != nil {
		prodDB.Close()
		commStore.Close()
		t.Fatalf("failed to put command receipt: %v", err)
	}

	// 3. Put export candidates and run successful handoff
	cand1 := product.ExportCandidate{
		ID:           "cand-gate-exported",
		SourceType:   "message",
		SourceID:     msg.ID,
		ExportFormat: "json",
		ContentHash:  "sha256:gate-hash-001",
		Status:       "pending",
		CreatedAt:    now,
	}
	if err := product.PutExportCandidate(ctx, prodDB, cand1); err != nil {
		prodDB.Close()
		commStore.Close()
		t.Fatalf("failed to put export candidate 1: %v", err)
	}

	payload1 := HandoffPayload{
		RawPayload: `{"title":"Gate Candidate 1","content":"Clean payload data for community"}`,
		Metadata:   map[string]string{"category": "general", "tag": "gate-test"},
	}

	res1, err := IngestAndAcknowledge(ctx, prodDB, commStore, cand1, payload1)
	if err != nil || res1.Status != "exported" {
		prodDB.Close()
		commStore.Close()
		t.Fatalf("failed handoff for candidate 1: res=%+v, err=%v", res1, err)
	}

	// 4. Put a second candidate that triggers quarantine and verify handoff acknowledges quarantined
	cand2 := product.ExportCandidate{
		ID:           "cand-gate-quarantined",
		SourceType:   "message",
		SourceID:     "msg-gate-002",
		ExportFormat: "json",
		ContentHash:  "sha256:gate-hash-002",
		Status:       "pending",
		CreatedAt:    now.Add(time.Second),
	}
	if err := product.PutExportCandidate(ctx, prodDB, cand2); err != nil {
		prodDB.Close()
		commStore.Close()
		t.Fatalf("failed to put export candidate 2: %v", err)
	}

	payload2 := HandoffPayload{
		RawPayload: `{"secret":"AKIAIOSFODNN7EXAMPLE"}`,
		Metadata:   map[string]string{"tag": "forbidden-secret"},
	}

	res2, err := IngestAndAcknowledge(ctx, prodDB, commStore, cand2, payload2)
	if err != nil || res2.Status != "quarantined" {
		prodDB.Close()
		commStore.Close()
		t.Fatalf("failed handoff for candidate 2: res=%+v, err=%v", res2, err)
	}

	// 5. Setup durable delivery attempt, publication receipt, removal report, and sync watermark
	delivery := community.DeliveryAttempt{
		ID:                "del-gate-001",
		ContributionID:    cand1.ID,
		TargetDestination: "community-sink-gate",
		AttemptNumber:     1,
		Status:            community.DeliverySucceeded,
		CreatedAt:         now.Add(2 * time.Second),
	}
	if err := commStore.RecordDeliveryAttempt(ctx, delivery); err != nil {
		prodDB.Close()
		commStore.Close()
		t.Fatalf("failed to record delivery attempt: %v", err)
	}

	pubReceipt := community.PublicationReceipt{
		ID:             "pub-gate-001",
		ContributionID: cand1.ID,
		ReceiptHash:    "sha256:pub-receipt-hash-gate",
		PublishedTo:    "community-registry-gate",
		PublishedAt:    now.Add(3 * time.Second),
		Metadata:       map[string]string{"published_by": "gate-producer"},
	}
	if err := commStore.RecordPublicationReceipt(ctx, pubReceipt); err != nil {
		prodDB.Close()
		commStore.Close()
		t.Fatalf("failed to record publication receipt: %v", err)
	}

	removal := community.RemovalReport{
		ID:             "rem-gate-001",
		ContributionID: cand2.ID,
		PluginSlug:     "quarantine-plugin",
		Reason:         "Leaked secret policy violation",
		ReporterRef:    "system-sanitizer",
		Status:         "processed",
		ReportedAt:     now.Add(4 * time.Second),
	}
	if err := commStore.RecordRemovalReport(ctx, removal); err != nil {
		prodDB.Close()
		commStore.Close()
		t.Fatalf("failed to record removal report: %v", err)
	}

	watermark := community.SyncWatermark{
		StreamID:       "stream-gate-001",
		LastSeq:        1,
		LastCheckpoint: "checkpoint-gate-001",
		UpdatedAt:      now.Add(5 * time.Second),
	}
	if err := commStore.UpdateSyncWatermark(ctx, watermark); err != nil {
		prodDB.Close()
		commStore.Close()
		t.Fatalf("failed to update sync watermark: %v", err)
	}

	// 6. Execute WAL checkpoint and cleanly close both DBs
	if _, err := prodDB.ExecContext(ctx, "PRAGMA wal_checkpoint(TRUNCATE);"); err != nil {
		t.Logf("product wal checkpoint warning: %v", err)
	}
	if err := prodDB.Close(); err != nil {
		t.Fatalf("failed to close product db: %v", err)
	}

	if _, err := commStore.DB().ExecContext(ctx, "PRAGMA wal_checkpoint(TRUNCATE);"); err != nil {
		t.Logf("community wal checkpoint warning: %v", err)
	}
	if err := commStore.Close(); err != nil {
		t.Fatalf("failed to close community store: %v", err)
	}

	// 7. Verify exactly the expected files exist
	prodExpected := filepath.Join(gateDir, product.DatabaseName)
	if _, err := os.Stat(prodExpected); err != nil {
		t.Fatalf("expected product db file missing at %q: %v", prodExpected, err)
	}
	if _, err := os.Stat(commPath); err != nil {
		t.Fatalf("expected community db file missing at %q: %v", commPath, err)
	}
}
