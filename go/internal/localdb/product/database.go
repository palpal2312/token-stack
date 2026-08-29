package product

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"
	"time"

	"agentic-os/internal/localdb/core"
)

const DatabaseName = "sen-product.db"

// Open creates or opens sen-product.db beneath root and brings its schema current.
func Open(ctx context.Context, root string) (*sql.DB, error) {
	return openPath(ctx, databasePath(root))
}

// Backup creates a verified product database snapshot.
func Backup(ctx context.Context, db *sql.DB, destination string) error {
	return core.Backup(ctx, db, destination)
}

// Restore verifies a product backup and restores it beneath a fresh root.
func Restore(ctx context.Context, backupPath, root string) (*sql.DB, error) {
	path := databasePath(root)
	if path == "" {
		return nil, errors.New("product database root is required")
	}
	if err := core.Restore(ctx, backupPath, path); err != nil {
		return nil, err
	}
	return openPath(ctx, path)
}

// QuarantineCorrupt moves corrupt sen-product.db bytes to a stable path.
func QuarantineCorrupt(root, reason string, now time.Time) (core.QuarantineReceipt, error) {
	path := databasePath(root)
	if path == "" {
		return core.QuarantineReceipt{}, errors.New("product database root is required")
	}
	return core.QuarantineCorrupt(path, reason, now)
}

func databasePath(root string) string {
	if root == "" {
		return ""
	}
	return filepath.Join(root, DatabaseName)
}

func openPath(ctx context.Context, path string) (*sql.DB, error) {
	if path == "" {
		return nil, errors.New("product database root is required")
	}
	db, err := core.Open(ctx, path)
	if err != nil {
		return nil, err
	}
	if err := core.IntegrityCheck(ctx, db); err != nil {
		db.Close()
		return nil, fmt.Errorf("verify product database: %w", err)
	}
	if err := core.Migrate(ctx, db, migrations); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate product database: %w", err)
	}
	return db, nil
}
