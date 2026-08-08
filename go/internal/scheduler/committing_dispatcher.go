// Package scheduler implements Phase 10 committing dispatch. The
// CommittingDispatcher builds on the dry-run scheduler by persisting fencing
// tokens on Attempt records, enforcing WIP limits (global, per-goal,
// per-account), and gating on a feature flag to toggle between dry-run and
// committing modes.
//
// In dry-run mode the dispatcher records what it *would* do but does not
// mutate Attempts. In committing mode each dispatch atomically writes a
// fencing token to the Attempt, preventing double-dispatch even across
// process restarts.
package scheduler

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"sync"
	"time"
)

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

// AttemptStatus enumerates the lifecycle of an Attempt.
type AttemptStatus string

const (
	AttemptStatusCreated   AttemptStatus = "created"
	AttemptStatusQueued    AttemptStatus = "queued"
	AttemptStatusRunning   AttemptStatus = "running"
	AttemptStatusSucceeded AttemptStatus = "succeeded"
	AttemptStatusFailed    AttemptStatus = "failed"
	AttemptStatusStopped   AttemptStatus = "stopped"
)

// Attempt mirrors the kanban attempt record and carries the fencing token
// that the committing dispatcher stamps when it dispatches work.
type Attempt struct {
	ID           string
	GoalID       string
	AccountID    string
	BuilderID    string
	Status       AttemptStatus
	FencingToken string // Opaque token set by CommittingDispatcher
	DispatchedAt *time.Time
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

// DispatchDecision captures the outcome of a single dispatch evaluation.
type DispatchDecision struct {
	AttemptID    string
	GoalID       string
	AccountID    string
	Dispatched   bool
	DryRun       bool
	FencingToken string
	Reason       string // human-readable reason code
	DecidedAt    time.Time
}

// WIPLimits configures per-axis concurrency caps. Zero means unlimited.
type WIPLimits struct {
	Global     int
	PerGoal    int
	PerAccount int
}

// DispatcherMode determines whether the dispatcher commits or only observes.
type DispatcherMode string

const (
	ModeDryRun     DispatcherMode = "dry-run"
	ModeCommitting DispatcherMode = "committing"
)

// ---------------------------------------------------------------------------
// AttemptStore is the persistence boundary the dispatcher writes through.
// Production implementations back this with the event spine or JSONL storage.
// ---------------------------------------------------------------------------

// AttemptStore abstracts the persistence layer for Attempt records.
type AttemptStore interface {
	// Get retrieves an attempt by ID. Returns nil, nil when not found.
	Get(attemptID string) (*Attempt, error)
	// ListActive returns all attempts with status queued or running.
	ListActive() ([]Attempt, error)
	// SetFencingToken persists the fencing token atomically. Implementations
	// must reject the write if the attempt already carries a different token
	// (compare-and-swap on empty -> token).
	SetFencingToken(attemptID, token string, at time.Time) error
	// Transition moves the attempt to a new status.
	Transition(attemptID string, to AttemptStatus, at time.Time) error
}

// ---------------------------------------------------------------------------
// Event sink — the dispatcher emits decision events into the domain spine.
// ---------------------------------------------------------------------------

// SchedulerEvent is published for each dispatch decision so downstream
// projectors and the activity feed can observe scheduler behaviour.
type SchedulerEvent struct {
	Type      string    `json:"type"` // "scheduler_dispatch_decided"
	AttemptID string    `json:"attemptId"`
	GoalID    string    `json:"goalId"`
	AccountID string    `json:"accountId"`
	DryRun    bool      `json:"dryRun"`
	Accepted  bool      `json:"accepted"`
	Reason    string    `json:"reason"`
	Token     string    `json:"token,omitempty"`
	At        time.Time `json:"at"`
}

// EventSink receives scheduler events. Nil sinks are tolerated (no-op).
type EventSink func(SchedulerEvent)

// ---------------------------------------------------------------------------
// CommittingDispatcher
// ---------------------------------------------------------------------------

// CommittingDispatcher evaluates dispatch requests against WIP limits and
// persists fencing tokens to prevent double-dispatch. When Mode is
// ModeDryRun, it evaluates limits and emits events but does not mutate the
// store.
type CommittingDispatcher struct {
	mu        sync.Mutex
	store     AttemptStore
	limits    WIPLimits
	mode      DispatcherMode
	eventSink EventSink
	decisions []DispatchDecision // running log for status introspection
}

// NewCommittingDispatcher creates a dispatcher with the given store, limits,
// and initial mode.
func NewCommittingDispatcher(store AttemptStore, limits WIPLimits, mode DispatcherMode, sink EventSink) *CommittingDispatcher {
	return &CommittingDispatcher{
		store:     store,
		limits:    limits,
		mode:      mode,
		eventSink: sink,
	}
}

// Mode returns the current operating mode.
func (d *CommittingDispatcher) Mode() DispatcherMode {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.mode
}

// SetMode transitions between dry-run and committing at runtime (feature flag).
func (d *CommittingDispatcher) SetMode(m DispatcherMode) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.mode = m
}

// Limits returns the current WIP limits.
func (d *CommittingDispatcher) Limits() WIPLimits {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.limits
}

// SetLimits updates the WIP limits at runtime.
func (d *CommittingDispatcher) SetLimits(l WIPLimits) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.limits = l
}

// Decisions returns a copy of the decision log.
func (d *CommittingDispatcher) Decisions() []DispatchDecision {
	d.mu.Lock()
	defer d.mu.Unlock()
	out := make([]DispatchDecision, len(d.decisions))
	copy(out, d.decisions)
	return out
}

// Dispatch evaluates the given attempt for dispatch. If WIP limits are
// satisfied and the mode is committing, a fencing token is persisted on the
// attempt. The decision is always logged and emitted regardless of mode.
func (d *CommittingDispatcher) Dispatch(attemptID string) (DispatchDecision, error) {
	d.mu.Lock()
	defer d.mu.Unlock()

	now := time.Now().UTC()

	attempt, err := d.store.Get(attemptID)
	if err != nil {
		return DispatchDecision{}, fmt.Errorf("scheduler: fetch attempt %s: %w", attemptID, err)
	}
	if attempt == nil {
		return DispatchDecision{}, fmt.Errorf("scheduler: attempt %s not found", attemptID)
	}

	// Already dispatched — idempotent success.
	if attempt.FencingToken != "" {
		dec := DispatchDecision{
			AttemptID:    attemptID,
			GoalID:       attempt.GoalID,
			AccountID:    attempt.AccountID,
			Dispatched:   true,
			DryRun:       d.mode == ModeDryRun,
			FencingToken: attempt.FencingToken,
			Reason:       "already_dispatched",
			DecidedAt:    now,
		}
		d.record(dec)
		return dec, nil
	}

	// --- WIP limit checks ---
	active, err := d.store.ListActive()
	if err != nil {
		return DispatchDecision{}, fmt.Errorf("scheduler: list active: %w", err)
	}

	if reason := d.checkLimits(active, attempt); reason != "" {
		dec := DispatchDecision{
			AttemptID: attemptID,
			GoalID:    attempt.GoalID,
			AccountID: attempt.AccountID,
			Dispatched: false,
			DryRun:    d.mode == ModeDryRun,
			Reason:    reason,
			DecidedAt: now,
		}
		d.record(dec)
		return dec, nil
	}

	// --- Generate fencing token ---
	token, err := generateFencingToken()
	if err != nil {
		return DispatchDecision{}, fmt.Errorf("scheduler: generate token: %w", err)
	}

	dec := DispatchDecision{
		AttemptID:    attemptID,
		GoalID:       attempt.GoalID,
		AccountID:    attempt.AccountID,
		Dispatched:   true,
		DryRun:       d.mode == ModeDryRun,
		FencingToken: token,
		Reason:       "wip_ok",
		DecidedAt:    now,
	}

	// Only persist in committing mode.
	if d.mode == ModeCommitting {
		if err := d.store.SetFencingToken(attemptID, token, now); err != nil {
			return DispatchDecision{}, fmt.Errorf("scheduler: persist token: %w", err)
		}
	}

	d.record(dec)
	return dec, nil
}

// checkLimits returns a non-empty reason string if any WIP cap would be
// exceeded by dispatching the given attempt.
func (d *CommittingDispatcher) checkLimits(active []Attempt, candidate *Attempt) string {
	// Only running attempts count against WIP.
	var globalRunning, goalRunning, accountRunning int
	for _, a := range active {
		if a.Status != AttemptStatusRunning {
			continue
		}
		globalRunning++
		if a.GoalID == candidate.GoalID {
			goalRunning++
		}
		if a.AccountID == candidate.AccountID {
			accountRunning++
		}
	}

	if d.limits.Global > 0 && globalRunning >= d.limits.Global {
		return "wip_global_exceeded"
	}
	if d.limits.PerGoal > 0 && goalRunning >= d.limits.PerGoal {
		return "wip_per_goal_exceeded"
	}
	if d.limits.PerAccount > 0 && accountRunning >= d.limits.PerAccount {
		return "wip_per_account_exceeded"
	}
	return ""
}

// record appends the decision to the log and emits an event.
func (d *CommittingDispatcher) record(dec DispatchDecision) {
	d.decisions = append(d.decisions, dec)
	if d.eventSink != nil {
		d.eventSink(SchedulerEvent{
			Type:      "scheduler_dispatch_decided",
			AttemptID: dec.AttemptID,
			GoalID:    dec.GoalID,
			AccountID: dec.AccountID,
			DryRun:    dec.DryRun,
			Accepted:  dec.Dispatched,
			Reason:    dec.Reason,
			Token:     dec.FencingToken,
			At:        dec.DecidedAt,
		})
	}
}

// Status returns a snapshot suitable for the /api/v1/scheduler/status endpoint.
func (d *CommittingDispatcher) Status() SchedulerStatus {
	d.mu.Lock()
	defer d.mu.Unlock()

	dispatched := 0
	rejected := 0
	for _, dec := range d.decisions {
		if dec.Dispatched {
			dispatched++
		} else {
			rejected++
		}
	}

	return SchedulerStatus{
		Mode:               string(d.mode),
		Limits:             d.limits,
		TotalDecisions:     len(d.decisions),
		DispatchedCount:    dispatched,
		RejectedCount:      rejected,
		RecentDecisions:    d.recentDecisions(20),
	}
}

// SchedulerStatus is the JSON-serializable status payload.
type SchedulerStatus struct {
	Mode            string             `json:"mode"`
	Limits          WIPLimits          `json:"limits"`
	TotalDecisions  int                `json:"totalDecisions"`
	DispatchedCount int                `json:"dispatchedCount"`
	RejectedCount   int                `json:"rejectedCount"`
	RecentDecisions []DispatchDecision `json:"recentDecisions"`
}

// recentDecisions returns up to n most recent decisions (caller holds mu).
func (d *CommittingDispatcher) recentDecisions(n int) []DispatchDecision {
	total := len(d.decisions)
	if total <= n {
		out := make([]DispatchDecision, total)
		copy(out, d.decisions)
		return out
	}
	out := make([]DispatchDecision, n)
	copy(out, d.decisions[total-n:])
	return out
}

// generateFencingToken produces a 16-byte hex-encoded token.
func generateFencingToken() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

// ---------------------------------------------------------------------------
// In-memory AttemptStore — used in tests and during the dry-run phase.
// ---------------------------------------------------------------------------

// MemoryAttemptStore is a thread-safe in-memory AttemptStore implementation.
type MemoryAttemptStore struct {
	mu       sync.Mutex
	attempts map[string]*Attempt
}

// NewMemoryAttemptStore creates an empty in-memory store.
func NewMemoryAttemptStore() *MemoryAttemptStore {
	return &MemoryAttemptStore{attempts: make(map[string]*Attempt)}
}

// Put inserts or replaces an attempt.
func (s *MemoryAttemptStore) Put(a Attempt) {
	s.mu.Lock()
	defer s.mu.Unlock()
	clone := a
	s.attempts[a.ID] = &clone
}

// Get retrieves an attempt by ID.
func (s *MemoryAttemptStore) Get(attemptID string) (*Attempt, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	a, ok := s.attempts[attemptID]
	if !ok {
		return nil, nil
	}
	clone := *a
	return &clone, nil
}

// ListActive returns all queued or running attempts.
func (s *MemoryAttemptStore) ListActive() ([]Attempt, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []Attempt
	for _, a := range s.attempts {
		if a.Status == AttemptStatusQueued || a.Status == AttemptStatusRunning {
			out = append(out, *a)
		}
	}
	return out, nil
}

// SetFencingToken sets the fencing token with CAS semantics.
func (s *MemoryAttemptStore) SetFencingToken(attemptID, token string, at time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	a, ok := s.attempts[attemptID]
	if !ok {
		return errors.New("attempt not found")
	}
	if a.FencingToken != "" && a.FencingToken != token {
		return errors.New("fencing token conflict: attempt already has a different token")
	}
	a.FencingToken = token
	a.DispatchedAt = &at
	a.UpdatedAt = at
	return nil
}

// Transition moves the attempt to a new status.
func (s *MemoryAttemptStore) Transition(attemptID string, to AttemptStatus, at time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	a, ok := s.attempts[attemptID]
	if !ok {
		return errors.New("attempt not found")
	}
	a.Status = to
	a.UpdatedAt = at
	return nil
}
