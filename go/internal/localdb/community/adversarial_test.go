package community

import (
	"context"
	"database/sql"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func tempDBPath(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	return filepath.Join(dir, "community-queue.db")
}

func TestSQLiteCommunityStore_PragmasAndMigrations(t *testing.T) {
	ctx := context.Background()
	dbPath := tempDBPath(t)

	store, err := OpenSQLiteCommunityStore(ctx, dbPath)
	if err != nil {
		t.Fatalf("OpenSQLiteCommunityStore failed: %v", err)
	}
	defer store.Close()

	// Verify PRAGMAs
	var journalMode string
	err = store.DB().QueryRowContext(ctx, "PRAGMA journal_mode;").Scan(&journalMode)
	if err != nil || journalMode != "wal" {
		t.Fatalf("expected WAL journal mode, got %q, err: %v", journalMode, err)
	}

	var foreignKeys int
	err = store.DB().QueryRowContext(ctx, "PRAGMA foreign_keys;").Scan(&foreignKeys)
	if err != nil || foreignKeys != 1 {
		t.Fatalf("expected foreign_keys=1, got %d, err: %v", foreignKeys, err)
	}

	var busyTimeout int
	err = store.DB().QueryRowContext(ctx, "PRAGMA busy_timeout;").Scan(&busyTimeout)
	if err != nil || busyTimeout != 5000 {
		t.Fatalf("expected busy_timeout=5000, got %d, err: %v", busyTimeout, err)
	}

	// Verify schema_migrations table has 4 migrations recorded
	var count int
	err = store.DB().QueryRowContext(ctx, "SELECT COUNT(*) FROM schema_migrations;").Scan(&count)
	if err != nil || count != len(MigrationsList) {
		t.Fatalf("expected %d migrations applied, got %d, err: %v", len(MigrationsList), count, err)
	}
}

func TestSQLiteCommunityStore_ReopenPersistence(t *testing.T) {
	ctx := context.Background()
	dbPath := tempDBPath(t)

	// Step 1: Open, write data, close
	store1, err := OpenSQLiteCommunityStore(ctx, dbPath)
	if err != nil {
		t.Fatalf("first open failed: %v", err)
	}

	item := SanitizedContribution{
		ID:         "persist-001",
		Title:      "Persisted Community Plugin",
		PluginSlug: "persisted-plugin",
		AuthorRef:  "usr-reopen-test",
		Version:    "1.2.0",
		Metadata: map[string]string{
			"category": "ai-pipeline",
			"license":  "Apache-2.0",
		},
	}
	if err := store1.Enqueue(ctx, item); err != nil {
		t.Fatalf("enqueue failed: %v", err)
	}
	if err := store1.Transition(ctx, "persist-001", StateSanitizing); err != nil {
		t.Fatalf("transition failed: %v", err)
	}
	if err := store1.UpdateSyncWatermark(ctx, SyncWatermark{StreamID: "stream-01", LastSeq: 42, LastCheckpoint: "cp-42"}); err != nil {
		t.Fatalf("update sync watermark failed: %v", err)
	}
	_ = store1.Close()

	// Step 2: Reopen same file and verify persisted state
	store2, err := OpenSQLiteCommunityStore(ctx, dbPath)
	if err != nil {
		t.Fatalf("second open failed: %v", err)
	}
	defer store2.Close()

	got, err := store2.Get(ctx, "persist-001")
	if err != nil || got == nil {
		t.Fatalf("get after reopen failed: %v", err)
	}
	if got.State != StateSanitizing {
		t.Fatalf("expected state sanitizing after reopen, got %q", got.State)
	}
	if got.Metadata["category"] != "ai-pipeline" {
		t.Fatalf("expected category ai-pipeline, got %q", got.Metadata["category"])
	}

	wm, err := store2.GetSyncWatermark(ctx, "stream-01")
	if err != nil || wm == nil || wm.LastSeq != 42 {
		t.Fatalf("expected watermark last_seq 42 after reopen, got %+v, err: %v", wm, err)
	}
}

func TestSQLiteCommunityStore_Adversarial_DuplicatePayloadIdempotency(t *testing.T) {
	ctx := context.Background()
	dbPath := tempDBPath(t)

	store, err := OpenSQLiteCommunityStore(ctx, dbPath)
	if err != nil {
		t.Fatalf("open failed: %v", err)
	}
	defer store.Close()

	item := SanitizedContribution{
		ID:         "dup-item-1",
		PluginSlug: "slug-1",
		AuthorRef:  "usr-dup",
		Metadata:   map[string]string{"tag": "test"},
	}

	if err := store.Enqueue(ctx, item); err != nil {
		t.Fatalf("first enqueue failed: %v", err)
	}

	// Duplicate enqueue with same ID must be rejected by unique constraint
	err = store.Enqueue(ctx, item)
	if err == nil {
		t.Fatal("expected duplicate enqueue to fail with constraint error")
	}
}

func TestSQLiteCommunityStore_Adversarial_ForbiddenFieldsAndSecretsScrubbed(t *testing.T) {
	ctx := context.Background()
	dbPath := tempDBPath(t)

	store, err := OpenSQLiteCommunityStore(ctx, dbPath)
	if err != nil {
		t.Fatalf("open failed: %v", err)
	}
	defer store.Close()

	adversarialCases := []struct {
		name string
		meta map[string]string
	}{
		{
			name: "forbidden raw prompt key",
			meta: map[string]string{"system_prompt": "You are a rogue assistant"},
		},
		{
			name: "forbidden code dump key",
			meta: map[string]string{"code_payload": "import os; os.system('rm -rf /')"},
		},
		{
			name: "forbidden jwt token in allowed field",
			meta: map[string]string{"doc_ref": "https://example.com/docs?token=eyJhbGciOi.eyJzdWIiOi.signature123"},
		},
		{
			name: "forbidden bearer auth in allowed field",
			meta: map[string]string{"homepage_ref": "https://example.com?auth=Bearer sk-ant-secret123456789"},
		},
		{
			name: "forbidden api_key in allowed field",
			meta: map[string]string{"repo_ref": "api_key=my_secret_token_12345678"},
		},
		{
			name: "forbidden pem private key block",
			meta: map[string]string{"doc_ref": "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----"},
		},
		{
			name: "forbidden password in allowed field",
			meta: map[string]string{"homepage_ref": "https://example.com/login?password=supersecretpassword123"},
		},
		{
			name: "oversized metadata field exceeding 1024 bytes",
			meta: map[string]string{"doc_ref": "https://example.com/" + strings.Repeat("a", 1050)},
		},
		{
			name: "null and control characters embedded in key",
			meta: map[string]string{"category\x00_malicious": "developer-tools"},
		},
	}

	for _, tc := range adversarialCases {
		t.Run(tc.name, func(t *testing.T) {
			item := SanitizedContribution{
				ID:         "adv-" + tc.name,
				PluginSlug: "adv-slug",
				AuthorRef:  "usr-attacker",
				Metadata:   tc.meta,
			}
			err := store.Enqueue(ctx, item)
			if err == nil {
				t.Fatalf("expected rejection for adversarial payload in case: %s", tc.name)
			}
		})
	}
}

func TestSQLiteCommunityStore_Delivery_Publication_RemovalLifecycle(t *testing.T) {
	ctx := context.Background()
	dbPath := tempDBPath(t)

	store, err := OpenSQLiteCommunityStore(ctx, dbPath)
	if err != nil {
		t.Fatalf("open failed: %v", err)
	}
	defer store.Close()

	contrib := SanitizedContribution{
		ID:         "contrib-life-01",
		Title:      "Lifecycle Plugin",
		PluginSlug: "lifecycle-plugin",
		AuthorRef:  "usr-lifecycle",
		Version:    "1.0.0",
		Metadata:   map[string]string{"category": "test"},
	}

	if err := store.Enqueue(ctx, contrib); err != nil {
		t.Fatalf("enqueue failed: %v", err)
	}

	// Advance through lifecycle: pending -> sanitizing -> sanitized
	_ = store.Transition(ctx, "contrib-life-01", StatusSanitizing)
	_ = store.Transition(ctx, "contrib-life-01", StatusSanitized)
	env, err := store.Export(ctx, "contrib-life-01")
	if err != nil || env == nil {
		t.Fatalf("export failed: %v", err)
	}

	// 1. Record delivery attempt (at-least-once)
	attempt := DeliveryAttempt{
		ID:                "deliv-01",
		ContributionID:    "contrib-life-01",
		AttemptNumber:     1,
		TargetDestination: "https://community.agentos.local/v1/publish",
		Status:            DeliverySucceeded,
		CreatedAt:         time.Now().UTC(),
	}
	if err := store.RecordDeliveryAttempt(ctx, attempt); err != nil {
		t.Fatalf("RecordDeliveryAttempt failed: %v", err)
	}

	// 2. Record immutable publication receipt -> marks status sanitized
	receipt := PublicationReceipt{
		ID:             "rcpt-01",
		ContributionID: "contrib-life-01",
		PublishedTo:    "https://community.agentos.local/v1/publish",
		ReceiptHash:    "hash-rcpt-01",
		PublishedAt:    time.Now().UTC(),
	}
	if err := store.RecordPublicationReceipt(ctx, receipt); err != nil {
		t.Fatalf("RecordPublicationReceipt failed: %v", err)
	}

	cDelivered, _ := store.Get(ctx, "contrib-life-01")
	if cDelivered.Status != StatusSanitized {
		t.Fatalf("expected status sanitized, got %q", cDelivered.Status)
	}

	// 3. Record removal report and tombstone (status -> rejected)
	report := RemovalReport{
		ID:             "rem-01",
		ContributionID: "contrib-life-01",
		PluginSlug:     "lifecycle-plugin",
		Reason:         "author request",
		ReporterRef:    "usr-lifecycle",
	}
	if err := store.RecordRemovalReport(ctx, report); err != nil {
		t.Fatalf("RecordRemovalReport failed: %v", err)
	}

	if err := store.Tombstone(ctx, "contrib-life-01", "processed removal"); err != nil {
		t.Fatalf("Tombstone failed: %v", err)
	}

	cTombstoned, _ := store.Get(ctx, "contrib-life-01")
	if cTombstoned.Status != StatusRejected {
		t.Fatalf("expected status rejected, got %q", cTombstoned.Status)
	}
}

func TestSQLiteCommunityStore_MigrationDriftDetection(t *testing.T) {
	dbPath := tempDBPath(t)

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open failed: %v", err)
	}
	defer db.Close()

	// Seed fake migration with corrupted checksum
	_, _ = db.ExecContext(context.Background(), `
		CREATE TABLE schema_migrations (
			version INTEGER PRIMARY KEY,
			name TEXT NOT NULL,
			checksum TEXT NOT NULL,
			applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
		INSERT INTO schema_migrations (version, name, checksum)
		VALUES (1, '0001_initial_meta_and_migrations', 'fake-tampered-checksum');
	`)

	// Running migrations must fail due to checksum drift
	err = RunMigrations(context.Background(), db)
	if err == nil {
		t.Fatal("expected migration drift error on mismatched checksum")
	}
}

func TestSQLiteCommunityStore_ConcurrentDuplicateEnqueue(t *testing.T) {
	ctx := context.Background()
	dbPath := tempDBPath(t)

	store, err := OpenSQLiteCommunityStore(ctx, dbPath)
	if err != nil {
		t.Fatalf("open failed: %v", err)
	}
	defer store.Close()

	var wg sync.WaitGroup
	var successCount int64
	var dupCount int64
	var mu sync.Mutex

	item := SanitizedContribution{
		ID:         "concurrent-same-id",
		Title:      "Duplicate Race Test",
		PluginSlug: "race-plugin",
		AuthorRef:  "usr-race",
		Version:    "1.0.0",
		Metadata:   map[string]string{"category": "test"},
	}

	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			err := store.Enqueue(ctx, item)
			mu.Lock()
			defer mu.Unlock()
			if err == nil {
				successCount++
			} else {
				dupCount++
			}
		}()
	}

	wg.Wait()

	if successCount != 1 {
		t.Fatalf("expected exactly 1 successful enqueue for duplicate ID, got %d", successCount)
	}
	if dupCount != 19 {
		t.Fatalf("expected 19 duplicate rejections, got %d", dupCount)
	}
}

func TestSQLiteCommunityStore_AdversarialCrashReplayAndWatermarkRestart(t *testing.T) {
	ctx := context.Background()
	dbPath := tempDBPath(t)

	// Step 1: Open, enqueue items, simulate sudden crash (close ungracefully or just reopen)
	store1, err := OpenSQLiteCommunityStore(ctx, dbPath)
	if err != nil {
		t.Fatalf("initial open failed: %v", err)
	}

	for i := 1; i <= 5; i++ {
		err := store1.Enqueue(ctx, SanitizedContribution{
			ID:          fmt.Sprintf("replay-item-%d", i),
			PayloadHash: fmt.Sprintf("hash-%d", i),
			Title:       fmt.Sprintf("Plugin %d", i),
			PluginSlug:  fmt.Sprintf("plugin-%d", i),
			AuthorRef:   "usr-replay",
			Version:     "1.0.0",
			Metadata:    map[string]string{"category": "test"},
		})
		if err != nil {
			t.Fatalf("enqueue item %d failed: %v", i, err)
		}
	}

	// Update watermark to checkpoint
	if err := store1.UpdateSyncWatermark(ctx, SyncWatermark{
		StreamID:       "main-stream",
		LastSeq:        3,
		LastCheckpoint: "replay-item-3",
	}); err != nil {
		t.Fatalf("watermark update failed: %v", err)
	}

	_ = store1.Close()

	// Step 2: Restart / Reopen and verify replay resumption point
	store2, err := OpenSQLiteCommunityStore(ctx, dbPath)
	if err != nil {
		t.Fatalf("restart open failed: %v", err)
	}
	defer store2.Close()

	wm, err := store2.GetSyncWatermark(ctx, "main-stream")
	if err != nil || wm == nil {
		t.Fatalf("watermark get failed after restart: %v", err)
	}
	if wm.LastSeq != 3 || wm.LastCheckpoint != "replay-item-3" {
		t.Fatalf("unexpected watermark on restart: %+v", wm)
	}

	// Query items
	rows, err := store2.DB().QueryContext(ctx, "SELECT id FROM sanitized_contributions ORDER BY id ASC")
	if err != nil {
		t.Fatalf("query failed: %v", err)
	}
	defer rows.Close()

	var allIDs []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			t.Fatalf("scan failed: %v", err)
		}
		allIDs = append(allIDs, id)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("rows err: %v", err)
	}
	if len(allIDs) != 5 {
		t.Fatalf("expected 5 items, got %d: %v", len(allIDs), allIDs)
	}
}

func TestSQLiteCommunityStore_ReceiptImmutabilityAndDeliveryRetry(t *testing.T) {
	ctx := context.Background()
	dbPath := tempDBPath(t)

	store, err := OpenSQLiteCommunityStore(ctx, dbPath)
	if err != nil {
		t.Fatalf("open failed: %v", err)
	}
	defer store.Close()

	item := SanitizedContribution{
		ID:         "contrib-retry-01",
		Title:      "Retry Test Plugin",
		PluginSlug: "retry-plugin",
		AuthorRef:  "usr-retry",
		Version:    "1.0.0",
		Metadata:   map[string]string{"category": "test"},
	}
	if err := store.Enqueue(ctx, item); err != nil {
		t.Fatalf("enqueue failed: %v", err)
	}

	// Attempt 1: Failed
	errMessage := "connection timeout 504"
	attempt1 := DeliveryAttempt{
		ID:                "deliv-att-1",
		ContributionID:    "contrib-retry-01",
		AttemptNumber:     1,
		TargetDestination: "https://remote.sink/v1",
		Status:            DeliveryFailed,
		Error:             &errMessage,
		CreatedAt:         time.Now().UTC(),
	}
	if err := store.RecordDeliveryAttempt(ctx, attempt1); err != nil {
		t.Fatalf("record attempt 1 failed: %v", err)
	}

	// Attempt 2: Success
	attempt2 := DeliveryAttempt{
		ID:                "deliv-att-2",
		ContributionID:    "contrib-retry-01",
		AttemptNumber:     2,
		TargetDestination: "https://remote.sink/v1",
		Status:            DeliverySucceeded,
		CreatedAt:         time.Now().UTC(),
	}
	if err := store.RecordDeliveryAttempt(ctx, attempt2); err != nil {
		t.Fatalf("record attempt 2 failed: %v", err)
	}

	// Publication Receipt Creation
	receipt := PublicationReceipt{
		ID:             "receipt-immut-01",
		ContributionID: "contrib-retry-01",
		PublishedTo:    "https://remote.sink/v1",
		ReceiptHash:    "hash-immutable-fixed-12345",
		PublishedAt:    time.Now().UTC(),
	}
	if err := store.RecordPublicationReceipt(ctx, receipt); err != nil {
		t.Fatalf("record publication receipt failed: %v", err)
	}

	// Receipt Immutability: duplicate receipt hash must fail unique constraint
	dupReceipt := PublicationReceipt{
		ID:             "receipt-immut-02",
		ContributionID: "contrib-retry-01",
		PublishedTo:    "https://remote.sink/v1",
		ReceiptHash:    "hash-immutable-fixed-12345",
		PublishedAt:    time.Now().UTC(),
	}
	err = store.RecordPublicationReceipt(ctx, dupReceipt)
	if err == nil {
		t.Fatal("expected duplicate receipt insertion to fail unique constraint on receipt_hash")
	}
}

func TestSQLiteCommunityStore_RuntimeIntrospection(t *testing.T) {
	ctx := context.Background()
	dbPath := tempDBPath(t)

	store, err := OpenSQLiteCommunityStore(ctx, dbPath)
	if err != nil {
		t.Fatalf("open failed: %v", err)
	}
	defer store.Close()

	// 1. Pragmas Check
	var jm string
	_ = store.DB().QueryRowContext(ctx, "PRAGMA journal_mode;").Scan(&jm)
	if jm != "wal" {
		t.Fatalf("expected wal, got %s", jm)
	}

	var syncMode int
	_ = store.DB().QueryRowContext(ctx, "PRAGMA synchronous;").Scan(&syncMode)
	if syncMode != 2 { // FULL = 2
		t.Fatalf("expected synchronous=2 (FULL), got %d", syncMode)
	}

	var fk int
	_ = store.DB().QueryRowContext(ctx, "PRAGMA foreign_keys;").Scan(&fk)
	if fk != 1 {
		t.Fatalf("expected foreign_keys=1, got %d", fk)
	}

	var bt int
	_ = store.DB().QueryRowContext(ctx, "PRAGMA busy_timeout;").Scan(&bt)
	if bt != 5000 {
		t.Fatalf("expected busy_timeout=5000, got %d", bt)
	}

	// 2. Table Introspection
	rows, err := store.DB().QueryContext(ctx, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name ASC")
	if err != nil {
		t.Fatalf("query tables failed: %v", err)
	}
	defer rows.Close()

	tables := make(map[string]bool)
	for rows.Next() {
		var name string
		_ = rows.Scan(&name)
		tables[name] = true
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("rows err: %v", err)
	}

	expectedTables := []string{
		"community_queue_meta",
		"delivery_attempts",
		"publication_receipts",
		"removal_reports",
		"sanitized_contributions",
		"schema_migrations",
		"sync_watermarks",
	}
	for _, tbl := range expectedTables {
		if !tables[tbl] {
			t.Fatalf("missing expected table: %s", tbl)
		}
	}

	// 3. Foreign Key Check
	var fkCheckViolations int
	fkRows, err := store.DB().QueryContext(ctx, "PRAGMA foreign_key_check;")
	if err != nil {
		t.Fatalf("foreign_key_check failed: %v", err)
	}
	defer fkRows.Close()
	for fkRows.Next() {
		fkCheckViolations++
	}
	if err := fkRows.Err(); err != nil {
		t.Fatalf("fkRows iteration err: %v", err)
	}
	if fkCheckViolations > 0 {
		t.Fatalf("found %d foreign key violations on fresh DB", fkCheckViolations)
	}
}

func TestSQLiteCommunityStore_PersistedTimestampPrecisionAndCheckConstraints(t *testing.T) {
	ctx := context.Background()
	dbPath := tempDBPath(t)

	store, err := OpenSQLiteCommunityStore(ctx, dbPath)
	if err != nil {
		t.Fatalf("open failed: %v", err)
	}
	defer store.Close()

	fixedTime := time.Date(2026, 8, 25, 12, 0, 0, 123456789, time.UTC)
	item := SanitizedContribution{
		ID:          "ts-precision-01",
		PayloadHash: "hash-ts-precision-01",
		Title:       "Timestamp Precision Item",
		PluginSlug:  "precision-plugin",
		AuthorRef:   "usr-ts-test",
		Version:     "1.0.0",
		Metadata:    map[string]string{"category": "test"},
		CreatedAt:   fixedTime,
	}

	if err := store.Enqueue(ctx, item); err != nil {
		t.Fatalf("enqueue failed: %v", err)
	}

	// 1. Inspect raw SQLite column value directly via SQL to ensure RFC3339 text persistence
	var rawCreatedAt string
	err = store.DB().QueryRowContext(ctx, "SELECT created_at FROM sanitized_contributions WHERE id = ?", "ts-precision-01").Scan(&rawCreatedAt)
	if err != nil {
		t.Fatalf("query raw timestamps failed: %v", err)
	}

	parsedCreated, err := time.Parse(time.RFC3339Nano, rawCreatedAt)
	if err != nil {
		t.Fatalf("persisted created_at %q is not valid RFC3339 text: %v", rawCreatedAt, err)
	}
	if !parsedCreated.Equal(fixedTime) {
		t.Fatalf("expected created_at %v, got %v", fixedTime, parsedCreated)
	}

	// 2. Verify CHECK constraints on status vocabulary (AO-15: pending, sanitizing, sanitized, quarantined, rejected)
	_, err = store.DB().ExecContext(ctx, "INSERT INTO sanitized_contributions (id, source, payload_hash, raw_payload, status, created_at) VALUES ('bad-status-1', 'src', 'h1', '{}', 'invalid_status', '2026-08-25T12:00:00Z')")
	if err == nil {
		t.Fatal("expected CHECK constraint violation on invalid status 'invalid_status'")
	}

	// Valid status values must succeed
	validStatuses := []string{"pending", "sanitizing", "sanitized", "quarantined", "rejected"}
	for i, st := range validStatuses {
		_, err := store.DB().ExecContext(ctx, fmt.Sprintf("INSERT INTO sanitized_contributions (id, source, payload_hash, raw_payload, status, created_at) VALUES ('valid-status-%d', 'src', 'h-val-%d', '{}', '%s', '2026-08-25T12:00:00Z')", i, i, st))
		if err != nil {
			t.Fatalf("expected valid status %q to succeed, got: %v", st, err)
		}
	}

	// 3. Verify CHECK constraints on delivery_attempts status vocabulary (AO-15: enqueued, sending, succeeded, failed, quarantined)
	_, err = store.DB().ExecContext(ctx, "INSERT INTO delivery_attempts (id, contribution_id, target_destination, attempt_number, status, created_at) VALUES ('bad-deliv-1', 'ts-precision-01', 'dest', 10, 'invalid_status', '2026-08-25T12:00:00Z')")
	if err == nil {
		t.Fatal("expected CHECK constraint violation on invalid delivery attempt status 'invalid_status'")
	}

	validDeliveryStatuses := []string{"enqueued", "sending", "succeeded", "failed", "quarantined"}
	for i, dst := range validDeliveryStatuses {
		_, err := store.DB().ExecContext(ctx, fmt.Sprintf("INSERT INTO delivery_attempts (id, contribution_id, target_destination, attempt_number, status, created_at) VALUES ('valid-deliv-%d', 'ts-precision-01', 'dest', %d, '%s', '2026-08-25T12:00:00Z')", i, i+1, dst))
		if err != nil {
			t.Fatalf("expected valid delivery status %q to succeed, got: %v", dst, err)
		}
	}

	// 4. Verify exact indexes exist
	var idxCount int
	err = store.DB().QueryRowContext(ctx, "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name IN ('idx_contrib_hash', 'idx_contrib_status', 'idx_delivery_status')").Scan(&idxCount)
	if err != nil || idxCount != 3 {
		t.Fatalf("expected exactly 3 exact AO-15 indexes (idx_contrib_hash, idx_contrib_status, idx_delivery_status), got %d, err: %v", idxCount, err)
	}
}

func TestSQLiteCommunityStore_AsyncExportCandidateIngestion(t *testing.T) {
	ctx := context.Background()
	dbPath := tempDBPath(t)

	store, err := OpenSQLiteCommunityStore(ctx, dbPath)
	if err != nil {
		t.Fatalf("open failed: %v", err)
	}
	defer store.Close()

	// 1. Valid ingestion without plugin_slug or author_ref requirement
	candidate := ProductExportCandidate{
		ID:           "ao14-cand-001",
		SourceType:   "product-export",
		SourceID:     "prod-src-99",
		ExportFormat: "json",
		ContentHash:  "hash-ao14-001",
		Status:       "ready",
		RawPayload:   `{"some":"clean_product_data"}`,
		Metadata: map[string]string{
			"category": "developer-tools",
			"license":  "MIT",
		},
		CreatedAt: time.Date(2026, 8, 25, 12, 30, 0, 0, time.UTC),
	}

	item, err := store.IngestExportCandidate(ctx, candidate)
	if err != nil {
		t.Fatalf("IngestExportCandidate failed: %v", err)
	}
	if item.ID != "ao14-cand-001" {
		t.Fatalf("expected ID ao14-cand-001, got %q", item.ID)
	}
	if item.Status != StatusPending {
		t.Fatalf("expected pending status, got %q", item.Status)
	}
	if item.PayloadHash != "hash-ao14-001" {
		t.Fatalf("expected payload hash hash-ao14-001, got %q", item.PayloadHash)
	}

	// 2. Idempotent replay: re-ingesting same candidate returns existing item without error
	replayedItem, err := store.IngestExportCandidate(ctx, candidate)
	if err != nil {
		t.Fatalf("idempotent replay ingestion failed: %v", err)
	}
	if replayedItem.ID != item.ID || replayedItem.PayloadHash != item.PayloadHash {
		t.Fatalf("idempotent replay returned mismatched item: %+v vs %+v", replayedItem, item)
	}

	// 3. Idempotent replay by content_hash with different candidate ID
	candidateSameHash := ProductExportCandidate{
		ID:           "ao14-cand-001-dup-id",
		SourceType:   "product-export",
		SourceID:     "prod-src-99",
		ExportFormat: "json",
		ContentHash:  "hash-ao14-001",
		Status:       "ready",
		RawPayload:   `{"some":"clean_product_data"}`,
		Metadata: map[string]string{
			"category": "developer-tools",
		},
	}
	sameHashItem, err := store.IngestExportCandidate(ctx, candidateSameHash)
	if err != nil {
		t.Fatalf("idempotent content_hash match failed: %v", err)
	}
	if sameHashItem.ID != "ao14-cand-001" {
		t.Fatalf("expected existing ID ao14-cand-001 on matching content_hash, got %q", sameHashItem.ID)
	}

	// 4. Ingestion with secret pattern in metadata -> quarantined without breaking queue
	badMetaCandidate := ProductExportCandidate{
		ID:           "ao14-bad-meta",
		SourceType:   "product-export",
		SourceID:     "prod-src-bad",
		ExportFormat: "json",
		ContentHash:  "hash-bad-meta",
		RawPayload:   `{"valid":"data"}`,
		Metadata: map[string]string{
			"doc_ref": "https://example.com/docs?token=Bearer secret-token-leak-12345",
		},
	}
	badMetaItem, err := store.IngestExportCandidate(ctx, badMetaCandidate)
	if err != nil {
		t.Fatalf("expected successful ingestion with quarantine status, got error: %v", err)
	}
	if badMetaItem.Status != StatusQuarantined {
		t.Fatalf("expected quarantined status for secret pattern, got %q", badMetaItem.Status)
	}
	if badMetaItem.QuarantineReason == nil || *badMetaItem.QuarantineReason == "" {
		t.Fatal("expected non-empty quarantine reason")
	}

	// 5. Ingestion with secret pattern in raw_payload -> quarantined without breaking queue
	badRawCandidate := ProductExportCandidate{
		ID:           "ao14-bad-raw",
		SourceType:   "product-export",
		SourceID:     "prod-src-bad-raw",
		ExportFormat: "json",
		ContentHash:  "hash-bad-raw",
		RawPayload:   `{"leaked_key":"Bearer super-secret-jwt-token"}`,
		Metadata: map[string]string{
			"category": "developer-tools",
		},
	}
	badRawItem, err := store.IngestExportCandidate(ctx, badRawCandidate)
	if err != nil {
		t.Fatalf("expected successful ingestion with quarantine status, got error: %v", err)
	}
	if badRawItem.Status != StatusQuarantined {
		t.Fatalf("expected quarantined status for raw payload secret, got %q", badRawItem.Status)
	}

	// 6. Ingestion with disallowed metadata key -> quarantined
	badKeyCandidate := ProductExportCandidate{
		ID:           "ao14-bad-key",
		SourceType:   "product-export",
		SourceID:     "prod-src-bad-key",
		ExportFormat: "json",
		ContentHash:  "hash-bad-key",
		RawPayload:   `{"valid":"data"}`,
		Metadata: map[string]string{
			"forbidden_sys_prompt": "You are a hacker",
		},
	}
	badKeyItem, err := store.IngestExportCandidate(ctx, badKeyCandidate)
	if err != nil {
		t.Fatalf("expected successful ingestion with quarantine status, got error: %v", err)
	}
	if badKeyItem.Status != StatusQuarantined {
		t.Fatalf("expected quarantined status for forbidden key, got %q", badKeyItem.Status)
	}

	// 7. Ingestion with nested JSON containing secret pattern -> quarantined
	nestedBadCand := ProductExportCandidate{
		ID:           "ao14-nested-bad",
		SourceType:   "product-export",
		SourceID:     "prod-src-nested",
		ExportFormat: "json",
		ContentHash:  "hash-nested-bad",
		RawPayload:   `{"nested":{"inner":{"config":{"api_key":"super-secret-key-12345"}}}}`,
		Metadata: map[string]string{
			"category": "developer-tools",
		},
	}
	nestedBadItem, err := store.IngestExportCandidate(ctx, nestedBadCand)
	if err != nil {
		t.Fatalf("expected successful ingestion with quarantine status, got error: %v", err)
	}
	if nestedBadItem.Status != StatusQuarantined {
		t.Fatalf("expected quarantined status for nested secret pattern, got %q", nestedBadItem.Status)
	}

	// 8. Ingestion with malformed JSON raw payload -> fallback rawPayload stored, no unhandled panic
	malformedJSONCand := ProductExportCandidate{
		ID:           "ao14-malformed-json",
		SourceType:   "product-export",
		SourceID:     "prod-src-malformed",
		ExportFormat: "json",
		ContentHash:  "hash-malformed-json",
		RawPayload:   `{malformed_json_not_valid: true, missing_quotes`,
		Metadata: map[string]string{
			"category": "developer-tools",
		},
	}
	malformedItem, err := store.IngestExportCandidate(ctx, malformedJSONCand)
	if err != nil {
		t.Fatalf("expected successful ingestion of malformed raw payload, got error: %v", err)
	}
	if malformedItem.Status != StatusPending {
		t.Fatalf("expected pending status, got %q", malformedItem.Status)
	}

	// 9. Verify sanitized_payload column NEVER persists raw secret in DB directly
	var (
		rawDBPayload       string
		sanitizedDBPayload sql.NullString
	)
	err = store.DB().QueryRowContext(ctx, "SELECT raw_payload, sanitized_payload FROM sanitized_contributions WHERE id = ?", "ao14-bad-raw").Scan(&rawDBPayload, &sanitizedDBPayload)
	if err != nil {
		t.Fatalf("failed to query db payload for quarantined candidate: %v", err)
	}
	if sanitizedDBPayload.Valid && sanitizedDBPayload.String != "" {
		t.Fatalf("sanitized_payload must be NULL or empty for quarantined secrets, got %q", sanitizedDBPayload.String)
	}

	// 10. Verify pending list contains ONLY valid candidate 1 and malformed (clean) candidate, excluding all quarantined items
	pending, err := store.ListPending(ctx)
	if err != nil {
		t.Fatalf("ListPending failed: %v", err)
	}
	if len(pending) != 2 {
		t.Fatalf("expected exactly 2 pending items, got %d", len(pending))
	}
}

func TestSQLiteCommunityStore_QueueOutageIsolation(t *testing.T) {
	ctx := context.Background()
	dbPath := tempDBPath(t)

	store, err := OpenSQLiteCommunityStore(ctx, dbPath)
	if err != nil {
		t.Fatalf("open failed: %v", err)
	}

	// Enqueue valid items
	_ = store.Enqueue(ctx, SanitizedContribution{
		ID:          "pre-outage-01",
		PayloadHash: "hash-pre-outage-01",
		Title:       "Pre Outage Item",
		Metadata:    map[string]string{"category": "test"},
	})

	// Simulate queue / DB outage by closing underlying connection
	_ = store.Close()

	// Attempting ingestion against closed/outage queue store returns isolated error, does not crash or corrupt
	_, err = store.IngestExportCandidate(ctx, ProductExportCandidate{
		ID:          "outage-cand-01",
		ContentHash: "hash-outage-01",
		RawPayload:  `{"test":"data"}`,
	})
	if err == nil {
		t.Fatal("expected error when ingesting during queue outage (closed DB)")
	}

	// Reopen store to verify queue recovers cleanly and previous data is intact
	recoveredStore, err := OpenSQLiteCommunityStore(ctx, dbPath)
	if err != nil {
		t.Fatalf("reopen after outage failed: %v", err)
	}
	defer recoveredStore.Close()

	item, err := recoveredStore.Get(ctx, "pre-outage-01")
	if err != nil || item == nil {
		t.Fatalf("failed to read item after queue recovery: %v", err)
	}
	if item.ID != "pre-outage-01" {
		t.Fatalf("expected item pre-outage-01, got %q", item.ID)
	}

	// Ingest candidate after recovery succeeds cleanly
	ingested, err := recoveredStore.IngestExportCandidate(ctx, ProductExportCandidate{
		ID:          "outage-cand-01",
		ContentHash: "hash-outage-01",
		RawPayload:  `{"test":"data"}`,
	})
	if err != nil || ingested == nil {
		t.Fatalf("ingest after recovery failed: %v", err)
	}
	if ingested.ID != "outage-cand-01" {
		t.Fatalf("expected ingested ID outage-cand-01, got %q", ingested.ID)
	}
}

func TestSQLiteCommunityStore_TerminalStateGuards_QuarantineAndTombstone(t *testing.T) {
	ctx := context.Background()
	dbPath := tempDBPath(t)

	store, err := OpenSQLiteCommunityStore(ctx, dbPath)
	if err != nil {
		t.Fatalf("open failed: %v", err)
	}
	defer store.Close()

	item := SanitizedContribution{
		ID:         "guard-db-01",
		Title:      "Guard Item",
		PluginSlug: "guard-slug",
		AuthorRef:  "usr-guard",
		Metadata:   map[string]string{"category": "test"},
	}
	if err := store.Enqueue(ctx, item); err != nil {
		t.Fatalf("enqueue failed: %v", err)
	}

	// 1. Valid pre-terminal quarantine succeeds
	if err := store.Quarantine(ctx, "guard-db-01", "Initial quarantine reason", "ERR_REASON"); err != nil {
		t.Fatalf("pre-terminal quarantine failed: %v", err)
	}

	// 2. Same quarantine retry is idempotent
	if err := store.Quarantine(ctx, "guard-db-01", "Initial quarantine reason", "ERR_REASON"); err != nil {
		t.Fatalf("idempotent quarantine retry failed: %v", err)
	}

	// 3. Incompatible quarantine retry fails
	if err := store.Quarantine(ctx, "guard-db-01", "Incompatible reason", "ERR_INCOMPATIBLE"); err == nil {
		t.Fatal("expected error on incompatible quarantine retry")
	}

	// 4. Tombstone to rejected (terminal)
	if err := store.Tombstone(ctx, "guard-db-01", "Tombstoned by admin"); err != nil {
		t.Fatalf("tombstone failed: %v", err)
	}

	gotTerm, err := store.Get(ctx, "guard-db-01")
	if err != nil || gotTerm == nil {
		t.Fatalf("failed to get tombstoned item: %v", err)
	}
	if gotTerm.Status != StatusRejected || gotTerm.State != StatusRejected {
		t.Fatalf("expected rejected status, got status=%q, state=%q", gotTerm.Status, gotTerm.State)
	}

	// 5. API-level enforcement: rejected item cannot be quarantined or transitioned
	if err := store.Quarantine(ctx, "guard-db-01", "Quarantine after reject", "ERR_FAIL"); err == nil {
		t.Fatal("expected API error when attempting to quarantine rejected contribution")
	}
	if err := store.Transition(ctx, "guard-db-01", StatusPending); err == nil {
		t.Fatal("expected API error when attempting to transition rejected contribution to pending")
	}
	if err := store.Transition(ctx, "guard-db-01", StatusSanitizing); err == nil {
		t.Fatal("expected API error when attempting to transition rejected contribution to sanitizing")
	}

	// 6. DB-level trigger enforcement: direct SQL UPDATE on rejected row must be aborted by trigger
	_, sqlErr := store.DB().ExecContext(ctx, "UPDATE sanitized_contributions SET status = 'pending' WHERE id = 'guard-db-01'")
	if sqlErr == nil {
		t.Fatal("expected DB trigger to abort transition from rejected to pending")
	}
	if !strings.Contains(sqlErr.Error(), "cannot transition from terminal rejected status") {
		t.Fatalf("unexpected trigger error message: %v", sqlErr)
	}

	_, sqlErr2 := store.DB().ExecContext(ctx, "UPDATE sanitized_contributions SET status = 'quarantined' WHERE id = 'guard-db-01'")
	if sqlErr2 == nil {
		t.Fatal("expected DB trigger to abort transition from rejected to quarantined")
	}

	// 7. Restart persistence: verify guard holds across restart
	_ = store.Close()
	reopenedStore, err := OpenSQLiteCommunityStore(ctx, dbPath)
	if err != nil {
		t.Fatalf("reopen failed: %v", err)
	}
	defer reopenedStore.Close()

	if err := reopenedStore.Quarantine(ctx, "guard-db-01", "Quarantine after restart", "ERR_FAIL"); err == nil {
		t.Fatal("expected error on quarantine after restart")
	}
	if err := reopenedStore.Transition(ctx, "guard-db-01", StatusPending); err == nil {
		t.Fatal("expected error on transition after restart")
	}

	// 8. Concurrency: concurrent quarantine retries & transitions against tombstone
	var wg sync.WaitGroup
	var rejCount int64
	var mu sync.Mutex

	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			if idx%2 == 0 {
				err := reopenedStore.Quarantine(ctx, "guard-db-01", fmt.Sprintf("Conc reason %d", idx), "ERR_CONC")
				if err != nil {
					mu.Lock()
					rejCount++
					mu.Unlock()
				}
			} else {
				err := reopenedStore.Transition(ctx, "guard-db-01", StatusPending)
				if err != nil {
					mu.Lock()
					rejCount++
					mu.Unlock()
				}
			}
		}(i)
	}
	wg.Wait()

	if rejCount != 20 {
		t.Fatalf("expected all 20 concurrent invalid mutations against rejected item to be rejected, got %d", rejCount)
	}
}

