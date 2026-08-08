package projections

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// PostgresCheckpointStore persists projection checkpoints to PostgreSQL so the
// daemon does not replay the full event spine on every restart.
type PostgresCheckpointStore struct {
	db *sql.DB
}

func NewPostgresCheckpointStore(db *sql.DB) (*PostgresCheckpointStore, error) {
	if db == nil {
		return nil, errors.New("database connection is required")
	}
	return &PostgresCheckpointStore{db: db}, nil
}

func (s *PostgresCheckpointStore) EnsureTable(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS projection_checkpoints (
			name            TEXT PRIMARY KEY,
			seq             BIGINT NOT NULL DEFAULT 0,
			projection_ver  TEXT NOT NULL DEFAULT '',
			last_applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			rebuild_status  TEXT NOT NULL DEFAULT 'new'
		)
	`)
	return err
}

func (s *PostgresCheckpointStore) Get(ctx context.Context, name string) (Checkpoint, error) {
	if name == "" {
		return Checkpoint{}, errors.New("checkpoint name is required")
	}
	row := s.db.QueryRowContext(ctx,
		`SELECT name, seq, projection_ver, last_applied_at, rebuild_status
		 FROM projection_checkpoints WHERE name = $1`, name)

	var cp Checkpoint
	var lastApplied time.Time
	err := row.Scan(&cp.Name, &cp.Seq, &cp.ProjectionVer, &lastApplied, &cp.RebuildStatus)
	if errors.Is(err, sql.ErrNoRows) {
		return Checkpoint{Name: name, RebuildStatus: "new"}, nil
	}
	if err != nil {
		return Checkpoint{}, err
	}
	cp.LastAppliedAt = lastApplied.UTC()
	return cp, nil
}

func (s *PostgresCheckpointStore) Apply(ctx context.Context, next Checkpoint, fn func(ctx context.Context) error) error {
	if next.Name == "" {
		return errors.New("checkpoint name is required")
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if fn != nil {
		if err := fn(ctx); err != nil {
			return err
		}
	}

	_, err = tx.ExecContext(ctx, `
		INSERT INTO projection_checkpoints (name, seq, projection_ver, last_applied_at, rebuild_status)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (name) DO UPDATE SET
			seq = EXCLUDED.seq,
			projection_ver = EXCLUDED.projection_ver,
			last_applied_at = EXCLUDED.last_applied_at,
			rebuild_status = EXCLUDED.rebuild_status
	`, next.Name, next.Seq, next.ProjectionVer, next.LastAppliedAt, next.RebuildStatus)
	if err != nil {
		return err
	}
	return tx.Commit()
}

func (s *PostgresCheckpointStore) Quarantine(ctx context.Context, checkpoint Checkpoint) error {
	if checkpoint.Name == "" {
		return errors.New("checkpoint name is required")
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO projection_checkpoints (name, seq, projection_ver, last_applied_at, rebuild_status)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (name) DO UPDATE SET
			rebuild_status = EXCLUDED.rebuild_status
	`, checkpoint.Name, checkpoint.Seq, checkpoint.ProjectionVer, checkpoint.LastAppliedAt, checkpoint.RebuildStatus)
	return err
}
