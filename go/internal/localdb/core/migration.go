package core

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"errors"
	"fmt"
	"sort"
	"time"
)

// Migration is one immutable, ordered schema change.
type Migration struct {
	Version int
	Name    string
	SQL     string
}

// Migrate applies pending migrations atomically in ascending version order.
func Migrate(ctx context.Context, db *sql.DB, migrations []Migration) error {
	if db == nil {
		return errors.New("database connection is required")
	}
	ordered := append([]Migration(nil), migrations...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].Version < ordered[j].Version })
	for i, migration := range ordered {
		if migration.Version <= 0 || migration.Name == "" || migration.SQL == "" {
			return fmt.Errorf("migration %d is invalid", migration.Version)
		}
		if i > 0 && migration.Version == ordered[i-1].Version {
			return fmt.Errorf("duplicate migration version %d", migration.Version)
		}
	}

	if _, err := db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		version TEXT PRIMARY KEY,
		applied_at TEXT NOT NULL CHECK(applied_at GLOB '????-??-??T??:??:??.???Z')
	);
	CREATE TABLE IF NOT EXISTS schema_migration_checksums (
		version TEXT PRIMARY KEY REFERENCES schema_migrations(version) ON DELETE RESTRICT,
		name TEXT NOT NULL,
		checksum BLOB NOT NULL
	)`); err != nil {
		return fmt.Errorf("create migration ledger: %w", err)
	}

	for _, migration := range ordered {
		checksum := sha256.Sum256([]byte(migration.SQL))
		var stored []byte
		err := db.QueryRowContext(ctx, "SELECT checksum FROM schema_migration_checksums WHERE version = ?", migration.Version).Scan(&stored)
		switch {
		case err == nil:
			if string(stored) != string(checksum[:]) {
				return fmt.Errorf("migration %d checksum mismatch", migration.Version)
			}
			continue
		case !errors.Is(err, sql.ErrNoRows):
			return fmt.Errorf("read migration %d: %w", migration.Version, err)
		}

		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return fmt.Errorf("begin migration %d: %w", migration.Version, err)
		}
		if _, err = tx.ExecContext(ctx, migration.SQL); err == nil {
			_, err = tx.ExecContext(ctx,
				"INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)",
				migration.Version, time.Now().UTC().Format("2006-01-02T15:04:05.000Z"))
		}
		if err == nil {
			_, err = tx.ExecContext(ctx,
				"INSERT INTO schema_migration_checksums(version, name, checksum) VALUES (?, ?, ?)",
				migration.Version, migration.Name, checksum[:])
		}
		if err != nil {
			tx.Rollback()
			return fmt.Errorf("apply migration %d (%s): %w", migration.Version, migration.Name, err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit migration %d: %w", migration.Version, err)
		}
	}
	return nil
}
