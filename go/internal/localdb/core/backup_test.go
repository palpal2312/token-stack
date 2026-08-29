package core

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestBackupIncludesCommittedWALAndRestoreReopens(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	db, err := Open(ctx, filepath.Join(root, "live.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec("CREATE TABLE records (value TEXT); INSERT INTO records VALUES ('committed-wal');"); err != nil {
		t.Fatal(err)
	}

	backup := filepath.Join(root, "backups", "snapshot.db")
	if err := Backup(ctx, db, backup); err != nil {
		t.Fatal(err)
	}
	restoredPath := filepath.Join(root, "restore", "fresh.db")
	if err := Restore(ctx, backup, restoredPath); err != nil {
		t.Fatal(err)
	}
	restored, err := Open(ctx, restoredPath)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	var value string
	if err := restored.QueryRow("SELECT value FROM records").Scan(&value); err != nil || value != "committed-wal" {
		t.Fatalf("restored value = %q, error = %v", value, err)
	}
}

func TestBackupFailureLeavesLiveDatabaseUntouched(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	db, err := Open(ctx, filepath.Join(root, "live.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec("CREATE TABLE records (value TEXT); INSERT INTO records VALUES ('live');"); err != nil {
		t.Fatal(err)
	}

	destination := filepath.Join(root, "existing.db")
	if err := os.WriteFile(destination, []byte("keep"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := Backup(ctx, db, destination); err == nil {
		t.Fatal("expected existing destination failure")
	}
	bytes, err := os.ReadFile(destination)
	if err != nil || string(bytes) != "keep" {
		t.Fatalf("destination changed: %q, error = %v", bytes, err)
	}
	var value string
	if err := db.QueryRow("SELECT value FROM records").Scan(&value); err != nil || value != "live" {
		t.Fatalf("live database changed: %q, error = %v", value, err)
	}
}

func TestRestoreRejectsMissingOrCorruptBackupWithoutCreatingDatabase(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	for _, backup := range []string{filepath.Join(root, "missing.db"), filepath.Join(root, "corrupt.db")} {
		if filepath.Base(backup) == "corrupt.db" {
			if err := os.WriteFile(backup, []byte("not sqlite bytes"), 0o600); err != nil {
				t.Fatal(err)
			}
		}
		destination := backup + ".restored"
		err := Restore(ctx, backup, destination)
		if err == nil {
			t.Fatalf("expected restore failure for %s", backup)
		}
		if filepath.Base(backup) == "corrupt.db" && !IsCorruption(err) {
			t.Fatalf("corrupt backup error not classified: %v", err)
		}
		if _, err := os.Stat(destination); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("destination created for %s: %v", backup, err)
		}
		if _, err := os.Stat(destination + operationSuffix); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("partial destination created for %s: %v", backup, err)
		}
	}
}

func TestRestoreRejectsCorruptionAndHealthyDestination(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	corrupt := filepath.Join(root, "corrupt.db")
	if err := os.WriteFile(corrupt, []byte("not sqlite bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	destination := filepath.Join(root, "healthy.db")
	healthy, err := Open(ctx, destination)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := healthy.Exec("CREATE TABLE keep (value TEXT); INSERT INTO keep VALUES ('healthy');"); err != nil {
		t.Fatal(err)
	}
	if err := healthy.Close(); err != nil {
		t.Fatal(err)
	}

	if err := Restore(ctx, corrupt, destination); err == nil {
		t.Fatal("expected restore refusal")
	}
	healthy, err = Open(ctx, destination)
	if err != nil {
		t.Fatal(err)
	}
	defer healthy.Close()
	var value string
	if err := healthy.QueryRow("SELECT value FROM keep").Scan(&value); err != nil || value != "healthy" {
		t.Fatalf("healthy destination changed: %q, error = %v", value, err)
	}
	if _, err := os.Stat(destination + operationSuffix); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("partial restore remains: %v", err)
	}
}

func TestPublishFileNeverOverwritesHealthyDestination(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "snapshot.partial")
	destination := filepath.Join(root, "healthy.db")
	if err := os.WriteFile(source, []byte("snapshot"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(destination, []byte("healthy"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := publishFile(source, destination); err == nil {
		t.Fatal("expected destination collision")
	}
	got, err := os.ReadFile(destination)
	if err != nil || string(got) != "healthy" {
		t.Fatalf("healthy destination = %q, error = %v", got, err)
	}
	got, err = os.ReadFile(source)
	if err != nil || string(got) != "snapshot" {
		t.Fatalf("source changed on collision = %q, error = %v", got, err)
	}
}

func TestPublishFileConcurrentRaceHasOneWinner(t *testing.T) {
	root := t.TempDir()
	destination := filepath.Join(root, "destination.db")
	sources := []string{filepath.Join(root, "one.partial"), filepath.Join(root, "two.partial")}
	for i, source := range sources {
		if err := os.WriteFile(source, []byte(fmt.Sprint(i+1)), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	start := make(chan struct{})
	errors := make(chan error, len(sources))
	for _, source := range sources {
		go func(path string) {
			<-start
			errors <- publishFile(path, destination)
		}(source)
	}
	close(start)
	succeeded := 0
	for range sources {
		if err := <-errors; err == nil {
			succeeded++
		}
	}
	if succeeded != 1 {
		t.Fatalf("publish winners = %d, want 1", succeeded)
	}
	got, err := os.ReadFile(destination)
	if err != nil || (string(got) != "1" && string(got) != "2") {
		t.Fatalf("destination = %q, error = %v", got, err)
	}
}

func TestQuarantineCorruptMovesExactSidecarsOnly(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "product.db")
	files := map[string]string{
		path:                                   "database",
		path + "-wal":                          "wal",
		path + "-shm":                          "shm",
		path + "-wal-unrelated":                "untouched",
		filepath.Join(root, "product.db2-wal"): "healthy sibling",
	}
	for name, content := range files {
		if err := os.WriteFile(name, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	receipt, err := QuarantineCorrupt(path, "corrupt", time.Date(2026, 8, 25, 10, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	wantSidecars := []string{path + "-wal.corrupt", path + "-shm.corrupt"}
	if fmt.Sprint(receipt.SidecarPaths) != fmt.Sprint(wantSidecars) {
		t.Fatalf("sidecar receipt = %v, want %v", receipt.SidecarPaths, wantSidecars)
	}
	for _, source := range []string{path, path + "-wal", path + "-shm"} {
		if _, err := os.Stat(source); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("quarantined source remains %s: %v", source, err)
		}
		if _, err := os.Stat(source + ".corrupt"); err != nil {
			t.Fatalf("quarantine missing %s: %v", source, err)
		}
	}
	for _, untouched := range []string{path + "-wal-unrelated", filepath.Join(root, "product.db2-wal")} {
		got, err := os.ReadFile(untouched)
		if err != nil || string(got) != files[untouched] {
			t.Fatalf("unrelated file %s changed: %q, %v", untouched, got, err)
		}
	}
}

func TestQuarantineThenReopenStartsWithoutSidecars(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	path := filepath.Join(root, "product.db")
	db, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("CREATE TABLE original (value TEXT)"); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	for _, sidecar := range []string{path + "-wal", path + "-shm"} {
		if err := os.WriteFile(sidecar, []byte("stale sidecar"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := QuarantineCorrupt(path, "test quarantine", time.Now()); err != nil {
		t.Fatal(err)
	}
	db, err = Open(ctx, path)
	if err != nil {
		t.Fatalf("reopen after quarantine: %v", err)
	}
	defer db.Close()
	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='original'").Scan(&count); err != nil || count != 0 {
		t.Fatalf("quarantined schema replayed: count=%d error=%v", count, err)
	}
}

func TestQuarantineSidecarCollisionMovesNothing(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "product.db")
	for _, file := range []string{path, path + "-wal", path + "-shm"} {
		if err := os.WriteFile(file, []byte(filepath.Base(file)), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(path+"-wal.corrupt", []byte("healthy quarantine"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := QuarantineCorrupt(path, "corrupt", time.Now()); err == nil {
		t.Fatal("expected sidecar destination collision")
	}
	for _, source := range []string{path, path + "-wal", path + "-shm"} {
		if _, err := os.Stat(source); err != nil {
			t.Fatalf("source moved despite preflight failure %s: %v", source, err)
		}
	}
	got, err := os.ReadFile(path + "-wal.corrupt")
	if err != nil || string(got) != "healthy quarantine" {
		t.Fatalf("healthy quarantine changed: %q, %v", got, err)
	}
}

func TestQuarantineCorruptIsDeterministic(t *testing.T) {
	path := filepath.Join(t.TempDir(), "product.db")
	bytes := []byte("corrupt bytes")
	if err := os.WriteFile(path, bytes, 0o600); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 8, 25, 9, 10, 11, 0, time.FixedZone("test", 3600))
	receipt, err := QuarantineCorrupt(path, "integrity_check failed", now)
	if err != nil {
		t.Fatal(err)
	}
	absolute, _ := filepath.Abs(path)
	if receipt.SourcePath != absolute || receipt.QuarantinePath != absolute+".corrupt" || receipt.Reason != "integrity_check failed" || !receipt.QuarantinedAt.Equal(now.UTC()) {
		t.Fatalf("unexpected receipt: %+v", receipt)
	}
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("source still exists: %v", err)
	}
	got, err := os.ReadFile(receipt.QuarantinePath)
	if err != nil || string(got) != string(bytes) {
		t.Fatalf("quarantined bytes = %q, error = %v", got, err)
	}
	if _, err := QuarantineCorrupt(path, "again", now); err == nil {
		t.Fatal("expected deterministic collision refusal")
	}
}
