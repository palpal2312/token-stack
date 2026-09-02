package main

import (
	"context"
	"path/filepath"
	"testing"

	"agentic-os/internal/localdb/product"
)

func TestRunBackupAndRestore(t *testing.T) {
	root := t.TempDir()
	db, err := product.Open(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	backup := filepath.Join(root, "snapshot.db")
	if err := run([]string{"backup", "--store-root", root, "--backup-file", backup}); err != nil {
		t.Fatal(err)
	}
	if err := run([]string{"restore", "--store-root", root, "--backup-file", backup, "--restore-root", filepath.Join(root, "restore")}); err != nil {
		t.Fatal(err)
	}
}

func TestRunRejectsMissingArguments(t *testing.T) {
	if err := run([]string{"backup"}); err == nil {
		t.Fatal("expected missing argument error")
	}
	if err := run([]string{"unknown"}); err == nil {
		t.Fatal("expected unknown operation error")
	}
	if err := run([]string{"backup", "--store-root", t.TempDir(), "--backup-file", "snapshot.db", "unexpected"}); err == nil {
		t.Fatal("expected positional argument error")
	}
}
