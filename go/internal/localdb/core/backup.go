package core

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const operationSuffix = ".partial"

// Backup writes a consistent SQLite snapshot, including committed WAL state.
func Backup(ctx context.Context, db *sql.DB, destination string) (err error) {
	if db == nil {
		return errors.New("database connection is required")
	}
	if destination == "" {
		return errors.New("backup destination is required")
	}
	if err := IntegrityCheck(ctx, db); err != nil {
		return fmt.Errorf("verify source before backup: %w", err)
	}
	destination, err = filepath.Abs(destination)
	if err != nil {
		return fmt.Errorf("resolve backup destination: %w", err)
	}
	if _, err := os.Stat(destination); err == nil {
		return fmt.Errorf("backup destination already exists: %s", destination)
	} else if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("inspect backup destination: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(destination), 0o700); err != nil {
		return fmt.Errorf("create backup directory: %w", err)
	}

	temporary := destination + operationSuffix
	if err := os.Remove(temporary); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("remove stale partial backup: %w", err)
	}
	defer func() {
		if err != nil {
			os.Remove(temporary)
		}
	}()

	literal := "'" + strings.ReplaceAll(filepath.ToSlash(temporary), "'", "''") + "'"
	if _, err = db.ExecContext(ctx, "VACUUM INTO "+literal); err != nil {
		return fmt.Errorf("create backup: %w", err)
	}
	backup, openErr := openReadOnly(ctx, temporary)
	if openErr != nil {
		return fmt.Errorf("open backup for verification: %w", openErr)
	}
	if checkErr := IntegrityCheck(ctx, backup); checkErr != nil {
		backup.Close()
		return fmt.Errorf("verify backup: %w", checkErr)
	}
	if closeErr := backup.Close(); closeErr != nil {
		return fmt.Errorf("close backup: %w", closeErr)
	}
	if err = publishFile(temporary, destination); err != nil {
		return fmt.Errorf("publish backup: %w", err)
	}
	return nil
}

// Restore verifies a backup then publishes it at a path that must not exist.
func Restore(ctx context.Context, backupPath, destination string) (err error) {
	if backupPath == "" {
		return errors.New("backup path is required")
	}
	if destination == "" {
		return errors.New("restore destination is required")
	}
	backupPath, err = filepath.Abs(backupPath)
	if err != nil {
		return fmt.Errorf("resolve backup path: %w", err)
	}
	destination, err = filepath.Abs(destination)
	if err != nil {
		return fmt.Errorf("resolve restore destination: %w", err)
	}
	if backupPath == destination {
		return errors.New("backup and restore destination must differ")
	}
	if _, err := os.Stat(destination); err == nil {
		return fmt.Errorf("restore destination already exists: %s", destination)
	} else if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("inspect restore destination: %w", err)
	}

	backup, err := openReadOnly(ctx, backupPath)
	if err != nil {
		return fmt.Errorf("open backup: %w", err)
	}
	if err := IntegrityCheck(ctx, backup); err != nil {
		backup.Close()
		return fmt.Errorf("verify backup before restore: %w", err)
	}
	if err := backup.Close(); err != nil {
		return fmt.Errorf("close backup: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(destination), 0o700); err != nil {
		return fmt.Errorf("create restore directory: %w", err)
	}

	temporary := destination + operationSuffix
	if err := os.Remove(temporary); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("remove stale partial restore: %w", err)
	}
	defer func() {
		if err != nil {
			os.Remove(temporary)
		}
	}()
	if err = copyFile(backupPath, temporary); err != nil {
		return fmt.Errorf("copy backup: %w", err)
	}
	restored, openErr := openReadOnly(ctx, temporary)
	if openErr != nil {
		return fmt.Errorf("open restored database: %w", openErr)
	}
	if checkErr := IntegrityCheck(ctx, restored); checkErr != nil {
		restored.Close()
		return fmt.Errorf("verify restored database: %w", checkErr)
	}
	if closeErr := restored.Close(); closeErr != nil {
		return fmt.Errorf("close restored database: %w", closeErr)
	}
	if err = publishFile(temporary, destination); err != nil {
		return fmt.Errorf("publish restored database: %w", err)
	}
	return nil
}

func publishFile(source, destination string) error {
	return moveNoReplace(source, destination)
}

// moveNoReplace atomically claims destination on Windows and POSIX. Both paths
// must share a filesystem, which callers guarantee by creating sibling temps.
func moveNoReplace(source, destination string) error {
	if err := os.Link(source, destination); err != nil {
		return err
	}
	if err := os.Remove(source); err != nil {
		// Keep destination: it is the successfully published hard link. Deleting it
		// after a path race could remove an unrelated replacement.
		return fmt.Errorf("published destination but could not remove source: %w", err)
	}
	return nil
}

func copyFile(source, destination string) (err error) {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	info, err := input.Stat()
	if err != nil {
		return err
	}
	output, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL, info.Mode().Perm())
	if err != nil {
		return err
	}
	defer func() {
		if closeErr := output.Close(); err == nil {
			err = closeErr
		}
	}()
	_, err = output.ReadFrom(input)
	return err
}

// QuarantineReceipt records deterministic isolation of corrupt database bytes.
type QuarantineReceipt struct {
	SourcePath     string
	QuarantinePath string
	SidecarPaths   []string
	Reason         string
	QuarantinedAt  time.Time
}

// QuarantinePath derives the stable quarantine location for a database path.
func QuarantinePath(path string) string { return path + ".corrupt" }

// QuarantineCorrupt moves corrupt bytes and exact SQLite sidecars aside without
// replacing healthy data or touching similarly named files.
func QuarantineCorrupt(path, reason string, now time.Time) (QuarantineReceipt, error) {
	if path == "" {
		return QuarantineReceipt{}, errors.New("database path is required")
	}
	if reason == "" {
		return QuarantineReceipt{}, errors.New("quarantine reason is required")
	}
	path, err := filepath.Abs(path)
	if err != nil {
		return QuarantineReceipt{}, fmt.Errorf("resolve database path: %w", err)
	}
	info, err := os.Lstat(path)
	if err != nil {
		return QuarantineReceipt{}, fmt.Errorf("inspect database: %w", err)
	}
	if !info.Mode().IsRegular() {
		return QuarantineReceipt{}, errors.New("database path must be a regular file")
	}

	sources := []string{path}
	for _, suffix := range []string{"-wal", "-shm"} {
		sidecar := path + suffix
		if info, err := os.Lstat(sidecar); err == nil {
			if !info.Mode().IsRegular() {
				return QuarantineReceipt{}, fmt.Errorf("SQLite sidecar must be a regular file: %s", sidecar)
			}
			sources = append(sources, sidecar)
		} else if !errors.Is(err, os.ErrNotExist) {
			return QuarantineReceipt{}, fmt.Errorf("inspect SQLite sidecar %s: %w", sidecar, err)
		}
	}
	for _, source := range sources {
		destination := QuarantinePath(source)
		if _, err := os.Lstat(destination); err == nil {
			return QuarantineReceipt{}, fmt.Errorf("quarantine destination already exists: %s", destination)
		} else if !errors.Is(err, os.ErrNotExist) {
			return QuarantineReceipt{}, fmt.Errorf("inspect quarantine destination: %w", err)
		}
	}

	moved := make([]string, 0, len(sources))
	for _, source := range sources {
		destination := QuarantinePath(source)
		if err := moveNoReplace(source, destination); err != nil {
			var rollbackErrors []error
			for i := len(moved) - 1; i >= 0; i-- {
				if rollbackErr := moveNoReplace(QuarantinePath(moved[i]), moved[i]); rollbackErr != nil {
					rollbackErrors = append(rollbackErrors, rollbackErr)
				}
			}
			if len(rollbackErrors) > 0 {
				return QuarantineReceipt{}, fmt.Errorf("quarantine %s: %w; rollback: %v", source, err, rollbackErrors)
			}
			return QuarantineReceipt{}, fmt.Errorf("quarantine %s: %w", source, err)
		}
		moved = append(moved, source)
	}

	sidecars := make([]string, 0, len(moved)-1)
	for _, source := range moved[1:] {
		sidecars = append(sidecars, QuarantinePath(source))
	}
	return QuarantineReceipt{
		SourcePath:     path,
		QuarantinePath: QuarantinePath(path),
		SidecarPaths:   sidecars,
		Reason:         reason,
		QuarantinedAt:  now.UTC(),
	}, nil
}
