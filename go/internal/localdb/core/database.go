package core

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

const (
	defaultBusyTimeout = 5_000
	maxOpenConnections = 1
)

// Open creates or opens a local SQLite database with safe defaults.
func Open(ctx context.Context, path string) (*sql.DB, error) {
	return open(ctx, path, false)
}

func openReadOnly(ctx context.Context, path string) (*sql.DB, error) {
	return open(ctx, path, true)
}

func open(ctx context.Context, path string, readOnly bool) (*sql.DB, error) {
	if path == "" {
		return nil, errors.New("database path is required")
	}
	if ctx == nil {
		return nil, errors.New("context is required")
	}

	path, err := filepath.Abs(path)
	if err != nil {
		return nil, fmt.Errorf("resolve database path: %w", err)
	}
	if readOnly {
		if _, err := os.Stat(path); err != nil {
			return nil, fmt.Errorf("inspect database: %w", err)
		}
	} else if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, fmt.Errorf("create database directory: %w", err)
	}

	query := url.Values{"_pragma": []string{
		"busy_timeout(" + fmt.Sprint(defaultBusyTimeout) + ")",
		"foreign_keys(ON)",
		"cache_size(-64000)",
		"temp_store(MEMORY)",
	}}
	if readOnly {
		query.Set("mode", "ro")
	} else {
		query["_pragma"] = append(query["_pragma"], "journal_mode(WAL)", "synchronous(FULL)")
	}
	dsn := "file:" + filepath.ToSlash(path) + "?" + query.Encode()
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}
	db.SetMaxOpenConns(maxOpenConnections)
	db.SetMaxIdleConns(maxOpenConnections)
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		if IsCorruption(err) {
			return nil, &CorruptionError{Err: err}
		}
		return nil, fmt.Errorf("initialize database: %w", err)
	}
	return db, nil
}

// CorruptionError marks bytes SQLite cannot safely use.
type CorruptionError struct {
	Detail string
	Err    error
}

func (e *CorruptionError) Error() string {
	if e.Err != nil {
		return "database corruption: " + e.Err.Error()
	}
	return "database corruption: " + e.Detail
}

func (e *CorruptionError) Unwrap() error { return e.Err }

// IsCorruption reports SQLite corruption and not-a-database failures.
func IsCorruption(err error) bool {
	var corruption *CorruptionError
	if errors.As(err, &corruption) {
		return true
	}
	var coded interface{ Code() int }
	if errors.As(err, &coded) {
		const (
			sqliteCorrupt = 11
			sqliteNotADB  = 26
		)
		code := coded.Code() & 0xff
		return code == sqliteCorrupt || code == sqliteNotADB
	}
	return false
}

// IntegrityCheck reports corruption detected by SQLite.
func IntegrityCheck(ctx context.Context, db *sql.DB) error {
	if db == nil {
		return errors.New("database connection is required")
	}
	rows, err := db.QueryContext(ctx, "PRAGMA integrity_check")
	if err != nil {
		if IsCorruption(err) {
			return &CorruptionError{Err: err}
		}
		return fmt.Errorf("integrity check: %w", err)
	}
	defer rows.Close()

	checked := false
	for rows.Next() {
		checked = true
		var result string
		if err := rows.Scan(&result); err != nil {
			return fmt.Errorf("integrity check result: %w", err)
		}
		if result != "ok" {
			return &CorruptionError{Detail: result}
		}
	}
	if err := rows.Err(); err != nil {
		if IsCorruption(err) {
			return &CorruptionError{Err: err}
		}
		return fmt.Errorf("integrity check: %w", err)
	}
	if !checked {
		return errors.New("integrity check returned no result")
	}
	return nil
}
