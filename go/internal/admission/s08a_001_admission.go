// Package admission owns the lane-local Sprint 08-A approval and admission records.
package admission

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

const MigrationID = "s08a_001"

var (
	ErrUnauthorized        = errors.New("admission: unauthorized")
	ErrExpired             = errors.New("admission: approval expired")
	ErrAlreadyDecided      = errors.New("admission: approval already decided")
	ErrIdempotencyConflict = errors.New("admission: idempotency conflict")
	ErrBudgetExceeded      = errors.New("admission: budget exceeded")
	ErrWIPExceeded         = errors.New("admission: wip exceeded")
)

type Status string

const (
	Pending  Status = "pending"
	Approved Status = "approved"
	Rejected Status = "rejected"
	Expired  Status = "expired"
)

type Approval struct {
	ID             string     `json:"id"`
	TenantID       string     `json:"tenantId"`
	RequesterID    string     `json:"requesterId"`
	IdempotencyKey string     `json:"idempotencyKey"`
	PayloadHash    string     `json:"payloadHash"`
	Status         Status     `json:"status"`
	ExpiresAt      time.Time  `json:"expiresAt"`
	DecidedBy      string     `json:"decidedBy,omitempty"`
	CreatedAt      time.Time  `json:"createdAt"`
	DecidedAt      *time.Time `json:"decidedAt,omitempty"`
}

type AuditEvent struct {
	ApprovalID string    `json:"approvalId"`
	TenantID   string    `json:"tenantId"`
	ActorID    string    `json:"actorId"`
	Action     string    `json:"action"`
	At         time.Time `json:"at"`
}

type state struct {
	Schema    string              `json:"schema"`
	Approvals map[string]Approval `json:"approvals"`
	Audit     []AuditEvent        `json:"audit"`
}

type Store struct {
	mu    sync.Mutex
	path  string
	state state
}

func Open(path string) (*Store, error) {
	s := &Store{path: path, state: state{Schema: MigrationID, Approvals: map[string]Approval{}}}
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(b, &s.state); err != nil {
		return nil, fmt.Errorf("admission: decode durable state: %w", err)
	}
	if s.state.Schema != MigrationID {
		return nil, fmt.Errorf("admission: unsupported schema %q", s.state.Schema)
	}
	if s.state.Approvals == nil {
		s.state.Approvals = map[string]Approval{}
	}
	return s, nil
}

func (s *Store) Create(a Approval) (Approval, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, existing := range s.state.Approvals {
		if existing.TenantID == a.TenantID && existing.IdempotencyKey == a.IdempotencyKey {
			if existing.PayloadHash != a.PayloadHash {
				return Approval{}, ErrIdempotencyConflict
			}
			return existing, nil
		}
	}
	if a.ID == "" || a.TenantID == "" || a.RequesterID == "" || a.IdempotencyKey == "" || a.PayloadHash == "" {
		return Approval{}, errors.New("admission: required opaque metadata missing")
	}
	if _, exists := s.state.Approvals[a.ID]; exists {
		return Approval{}, ErrIdempotencyConflict
	}
	a.Status = Pending
	a.CreatedAt = time.Now().UTC()
	s.state.Approvals[a.ID] = a
	s.state.Audit = append(s.state.Audit, AuditEvent{a.ID, a.TenantID, a.RequesterID, "approval_created", a.CreatedAt})
	return a, s.persist()
}

func (s *Store) Decide(tenantID, actorID, id string, decision Status, now time.Time) (Approval, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	a, ok := s.state.Approvals[id]
	if !ok || a.TenantID != tenantID {
		return Approval{}, ErrUnauthorized
	}
	if actorID == "" || actorID == a.RequesterID {
		return Approval{}, ErrUnauthorized
	}
	if a.Status != Pending {
		return Approval{}, ErrAlreadyDecided
	}
	if !now.Before(a.ExpiresAt) {
		a.Status = Expired
		s.state.Approvals[id] = a
		s.state.Audit = append(s.state.Audit, AuditEvent{id, tenantID, actorID, "approval_expired", now.UTC()})
		if err := s.persist(); err != nil {
			return Approval{}, err
		}
		return Approval{}, ErrExpired
	}
	if decision != Approved && decision != Rejected {
		return Approval{}, errors.New("admission: invalid decision")
	}
	t := now.UTC()
	a.Status, a.DecidedBy, a.DecidedAt = decision, actorID, &t
	s.state.Approvals[id] = a
	s.state.Audit = append(s.state.Audit, AuditEvent{id, tenantID, actorID, "approval_" + string(decision), t})
	return a, s.persist()
}

func (s *Store) Get(tenantID, id string) (Approval, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	a, ok := s.state.Approvals[id]
	if !ok || a.TenantID != tenantID {
		return Approval{}, ErrUnauthorized
	}
	return a, nil
}

func (s *Store) Audit(tenantID string) []AuditEvent {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]AuditEvent, 0)
	for _, e := range s.state.Audit {
		if e.TenantID == tenantID {
			out = append(out, e)
		}
	}
	return out
}

func (s *Store) persist() error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0700); err != nil {
		return err
	}
	b, err := json.Marshal(s.state)
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

type Request struct {
	ID, TenantID, GoalID string
	CreatedAt            time.Time
	EstimatedCost        int64
}

func AdmitFair(pending []Request, activeByTenant map[string]int, maxGlobal, maxPerTenant int, spent, budget int64) ([]Request, error) {
	if budget > 0 {
		var requested int64
		for _, r := range pending {
			requested += r.EstimatedCost
		}
		if spent+requested > budget {
			return nil, ErrBudgetExceeded
		}
	}
	sort.SliceStable(pending, func(i, j int) bool {
		li, lj := activeByTenant[pending[i].TenantID], activeByTenant[pending[j].TenantID]
		if li != lj {
			return li < lj
		}
		if !pending[i].CreatedAt.Equal(pending[j].CreatedAt) {
			return pending[i].CreatedAt.Before(pending[j].CreatedAt)
		}
		return pending[i].ID < pending[j].ID
	})
	result := make([]Request, 0)
	for _, r := range pending {
		if maxGlobal > 0 && len(result) >= maxGlobal {
			break
		}
		if maxPerTenant > 0 && activeByTenant[r.TenantID] >= maxPerTenant {
			continue
		}
		result = append(result, r)
		activeByTenant[r.TenantID]++
	}
	if len(result) == 0 && len(pending) > 0 {
		return nil, ErrWIPExceeded
	}
	return result, nil
}
