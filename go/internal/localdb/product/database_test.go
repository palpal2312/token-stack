package product

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"agentic-os/internal/localdb/core"
)

func TestOpenCreatesDurableProductDatabase(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	db, err := Open(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)
	if err := PutMessage(ctx, db, Message{ID: "message-1", SessionID: "session-1", Role: "user", Content: "local", CreatedAt: now}); err != nil {
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
	var value string
	if err := db.QueryRow("SELECT content FROM sen_messages WHERE id='message-1'").Scan(&value); err != nil || value != "local" {
		t.Fatalf("persisted value = %q, error = %v", value, err)
	}
	if _, err := os.Stat(filepath.Join(root, DatabaseName)); err != nil {
		t.Fatalf("product database missing: %v", err)
	}
}

func TestOpenRejectsEmptyRoot(t *testing.T) {
	if _, err := Open(context.Background(), ""); err == nil {
		t.Fatal("expected empty root error")
	}
}

func TestBackupRestoreAndReopen(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	db, err := Open(ctx, filepath.Join(root, "live"))
	if err != nil {
		t.Fatal(err)
	}
	if err := PutMessage(ctx, db, Message{ID: "wal", SessionID: "session-1", Role: "user", Content: "committed", CreatedAt: time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)}); err != nil {
		t.Fatal(err)
	}
	backup := filepath.Join(root, "backup", DatabaseName)
	if err := Backup(ctx, db, backup); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	restoredRoot := filepath.Join(root, "restored")
	restored, err := Restore(ctx, backup, restoredRoot)
	if err != nil {
		t.Fatal(err)
	}
	var value string
	if err := restored.QueryRow("SELECT content FROM sen_messages WHERE id='wal'").Scan(&value); err != nil || value != "committed" {
		t.Fatalf("restored value = %q, error = %v", value, err)
	}
	if err := restored.Close(); err != nil {
		t.Fatal(err)
	}
	restored, err = Open(ctx, restoredRoot)
	if err != nil {
		t.Fatalf("reopen restored product database: %v", err)
	}
	defer restored.Close()
	if err := core.IntegrityCheck(ctx, restored); err != nil {
		t.Fatal(err)
	}
}

func TestQuarantineCorruptProductDatabase(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, DatabaseName)
	if err := os.WriteFile(path, []byte("corrupt product bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)
	receipt, err := QuarantineCorrupt(root, "not a database", now)
	if err != nil {
		t.Fatal(err)
	}
	if receipt.QuarantinePath != path+".corrupt" || receipt.Reason != "not a database" || !receipt.QuarantinedAt.Equal(now) {
		t.Fatalf("unexpected receipt: %+v", receipt)
	}
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("source not quarantined: %v", err)
	}
	if _, err := os.Stat(receipt.QuarantinePath); err != nil {
		t.Fatal(err)
	}
}
