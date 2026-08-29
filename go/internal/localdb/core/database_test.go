package core

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
)

func TestOpenAndMigrate(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "nested", "core.db")
	db, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	migrations := []Migration{
		{Version: 2, Name: "add value", SQL: "ALTER TABLE records ADD COLUMN value TEXT NOT NULL DEFAULT '';"},
		{Version: 1, Name: "create records", SQL: "CREATE TABLE records (id INTEGER PRIMARY KEY);"},
	}
	if err := Migrate(ctx, db, migrations); err != nil {
		t.Fatal(err)
	}
	if err := Migrate(ctx, db, migrations); err != nil {
		t.Fatalf("migration replay must be idempotent: %v", err)
	}

	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM schema_migrations").Scan(&count); err != nil || count != 2 {
		t.Fatalf("migration count = %d, error = %v", count, err)
	}
	var journalMode string
	if err := db.QueryRow("PRAGMA journal_mode").Scan(&journalMode); err != nil || journalMode != "wal" {
		t.Fatalf("journal mode = %q, error = %v", journalMode, err)
	}
	var foreignKeys int
	if err := db.QueryRow("PRAGMA foreign_keys").Scan(&foreignKeys); err != nil || foreignKeys != 1 {
		t.Fatalf("foreign_keys = %d, error = %v", foreignKeys, err)
	}
	if err := IntegrityCheck(ctx, db); err != nil {
		t.Fatal(err)
	}
}

func TestMigrateRollsBackFailedChange(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "rollback.db")
	db, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	err = Migrate(ctx, db, []Migration{{
		Version: 1,
		Name:    "fails halfway",
		SQL:     "CREATE TABLE leaked (id INTEGER); INSERT INTO missing_table VALUES (1);",
	}})
	if err == nil {
		t.Fatal("expected migration failure")
	}
	var name string
	err = db.QueryRow("SELECT name FROM sqlite_master WHERE type='table' AND name='leaked'").Scan(&name)
	if err != sql.ErrNoRows {
		t.Fatalf("failed migration leaked schema: %v", err)
	}
	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM schema_migrations").Scan(&count); err != nil || count != 0 {
		t.Fatalf("failed migration ledger count = %d, error = %v", count, err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	db, err = Open(ctx, path)
	if err != nil {
		t.Fatalf("reopen after failed migration: %v", err)
	}
	defer db.Close()
	if err := db.QueryRow("SELECT COUNT(*) FROM schema_migrations").Scan(&count); err != nil || count != 0 {
		t.Fatalf("ledger after reopen = %d, error = %v", count, err)
	}
}

func TestMigrateRejectsChangedHistory(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "checksum.db")
	db, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	if err := Migrate(ctx, db, []Migration{{Version: 1, Name: "one", SQL: "CREATE TABLE one (id INTEGER);"}}); err != nil {
		t.Fatal(err)
	}
	if err := Migrate(ctx, db, []Migration{{Version: 1, Name: "one", SQL: "CREATE TABLE changed (id INTEGER);"}}); err == nil {
		t.Fatal("expected checksum mismatch")
	}
	var name string
	if err := db.QueryRow("SELECT name FROM sqlite_master WHERE type='table' AND name='changed'").Scan(&name); err != sql.ErrNoRows {
		t.Fatalf("checksum drift changed schema: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	db, err = Open(ctx, path)
	if err != nil {
		t.Fatalf("reopen after checksum drift: %v", err)
	}
	defer db.Close()
	if err := db.QueryRow("SELECT name FROM sqlite_master WHERE type='table' AND name='one'").Scan(&name); err != nil {
		t.Fatalf("original schema missing after reopen: %v", err)
	}
}
