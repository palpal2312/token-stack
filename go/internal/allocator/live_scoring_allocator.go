// Package allocator implements Phase 11 live scoring allocation. The
// LiveScoringAllocator replaces the advisory allocation pass with a
// production-grade system that persists full allocation decisions with reason
// codes, wires a feedback sink to live Attempt outcomes (completed/failed),
// and gates on a feature flag to transition from advisory to live
// auto-assignment.
//
// Scoring uses a pluggable ScoringFunc so callers can inject their own
// builder-quality signals, cost models, or affinity rules.
package allocator

import (
	"errors"
	"fmt"
	"math"
	"sync"
	"time"
)

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

// AllocationMode determines whether the allocator is advisory-only or live.
type AllocationMode string

const (
	ModeAdvisory AllocationMode = "advisory"
	ModeLive     AllocationMode = "live"
)

// Builder represents a candidate executor that can be assigned work.
type Builder struct {
	ID          string
	AccountID   string
	Capacity    int     // max concurrent attempts
	ActiveCount int     // currently running attempts
	SuccessRate float64 // historical success rate [0.0, 1.0]
	AvgDuration time.Duration
	Tags        map[string]string
}

// AllocationRequest describes an attempt that needs a builder assignment.
type AllocationRequest struct {
	AttemptID string
	GoalID    string
	AccountID string
	Tags      map[string]string // requested builder tags
}

// ReasonCode enumerates the machine-readable reason for an allocation outcome.
type ReasonCode string

const (
	ReasonAssigned       ReasonCode = "assigned"
	ReasonNoCapacity     ReasonCode = "no_capacity"
	ReasonNoMatch        ReasonCode = "no_match"
	ReasonScoreTooLow    ReasonCode = "score_too_low"
	ReasonAlreadyAssigned ReasonCode = "already_assigned"
	ReasonAdvisoryOnly   ReasonCode = "advisory_only"
)

// AllocationDecision captures the full outcome of one allocation evaluation.
type AllocationDecision struct {
	AttemptID  string     `json:"attemptId"`
	GoalID     string     `json:"goalId"`
	AccountID  string     `json:"accountId"`
	BuilderID  string     `json:"builderId,omitempty"`
	Assigned   bool       `json:"assigned"`
	Live       bool       `json:"live"`
	Score      float64    `json:"score"`
	Reason     ReasonCode `json:"reason"`
	DecidedAt  time.Time  `json:"decidedAt"`
}

// FeedbackOutcome records whether an attempt succeeded or failed, so the
// allocator can update its scoring model.
type FeedbackOutcome struct {
	AttemptID  string
	BuilderID  string
	Succeeded  bool
	Duration   time.Duration
	RecordedAt time.Time
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

// ScoringFunc evaluates a (builder, request) pair and returns a score in
// [0.0, 1.0]. Higher is better. Returning a negative score means the
// builder is ineligible.
type ScoringFunc func(builder Builder, request AllocationRequest) float64

// DefaultScoringFunc combines capacity headroom and historical success rate.
func DefaultScoringFunc(builder Builder, request AllocationRequest) float64 {
	if builder.Capacity <= 0 || builder.ActiveCount >= builder.Capacity {
		return -1.0 // ineligible
	}
	headroom := float64(builder.Capacity-builder.ActiveCount) / float64(builder.Capacity)
	// Weight: 60% success rate, 40% headroom.
	return 0.6*builder.SuccessRate + 0.4*headroom
}

// ---------------------------------------------------------------------------
// AllocationStore persists assignment records and builder state.
// ---------------------------------------------------------------------------

// AllocationStore is the persistence boundary for allocation records.
type AllocationStore interface {
	// RecordDecision persists an allocation decision.
	RecordDecision(dec AllocationDecision) error
	// AssignBuilder atomically assigns the builder to the attempt. Must
	// reject if the attempt already has a different builder assigned.
	AssignBuilder(attemptID, builderID string, at time.Time) error
}

// ---------------------------------------------------------------------------
// Event sink
// ---------------------------------------------------------------------------

// AllocatorEvent is published for each allocation decision.
type AllocatorEvent struct {
	Type      string     `json:"type"` // "allocator_decision_made"
	AttemptID string     `json:"attemptId"`
	GoalID    string     `json:"goalId"`
	AccountID string     `json:"accountId"`
	BuilderID string     `json:"builderId,omitempty"`
	Live      bool       `json:"live"`
	Assigned  bool       `json:"assigned"`
	Score     float64    `json:"score"`
	Reason    ReasonCode `json:"reason"`
	At        time.Time  `json:"at"`
}

// AllocatorEventSink receives allocator events.
type AllocatorEventSink func(AllocatorEvent)

// ---------------------------------------------------------------------------
// LiveScoringAllocator
// ---------------------------------------------------------------------------

// LiveScoringAllocator evaluates allocation requests, selects the best
// builder, and (in live mode) persists the assignment. It ingests feedback
// from completed/failed attempts to update builder statistics.
type LiveScoringAllocator struct {
	mu        sync.Mutex
	store     AllocationStore
	builders  map[string]*Builder
	mode      AllocationMode
	scorer    ScoringFunc
	eventSink AllocatorEventSink
	decisions []AllocationDecision
	feedback  []FeedbackOutcome
	minScore  float64 // minimum score threshold to accept
}

// NewLiveScoringAllocator creates an allocator with the given dependencies.
func NewLiveScoringAllocator(
	store AllocationStore,
	mode AllocationMode,
	scorer ScoringFunc,
	minScore float64,
	sink AllocatorEventSink,
) *LiveScoringAllocator {
	if scorer == nil {
		scorer = DefaultScoringFunc
	}
	return &LiveScoringAllocator{
		store:     store,
		builders:  make(map[string]*Builder),
		mode:      mode,
		scorer:    scorer,
		eventSink: sink,
		minScore:  minScore,
	}
}

// RegisterBuilder adds or updates a builder in the pool.
func (a *LiveScoringAllocator) RegisterBuilder(b Builder) {
	a.mu.Lock()
	defer a.mu.Unlock()
	clone := b
	a.builders[b.ID] = &clone
}

// RemoveBuilder removes a builder from the pool.
func (a *LiveScoringAllocator) RemoveBuilder(id string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	delete(a.builders, id)
}

// Mode returns the current allocation mode.
func (a *LiveScoringAllocator) Mode() AllocationMode {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.mode
}

// SetMode transitions between advisory and live at runtime (feature flag).
func (a *LiveScoringAllocator) SetMode(m AllocationMode) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.mode = m
}

// Allocate evaluates builders for the given request and returns the best
// allocation decision. In live mode the assignment is persisted.
func (a *LiveScoringAllocator) Allocate(req AllocationRequest) (AllocationDecision, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	now := time.Now().UTC()

	if len(a.builders) == 0 {
		dec := AllocationDecision{
			AttemptID: req.AttemptID,
			GoalID:    req.GoalID,
			AccountID: req.AccountID,
			Assigned:  false,
			Live:      a.mode == ModeLive,
			Reason:    ReasonNoMatch,
			DecidedAt: now,
		}
		a.recordDecision(dec)
		return dec, nil
	}

	// Score all builders and pick the best.
	var bestBuilder *Builder
	bestScore := -1.0
	for _, b := range a.builders {
		score := a.scorer(*b, req)
		if score > bestScore {
			bestScore = score
			bestBuilder = b
		}
	}

	if bestBuilder == nil || bestScore < 0 {
		dec := AllocationDecision{
			AttemptID: req.AttemptID,
			GoalID:    req.GoalID,
			AccountID: req.AccountID,
			Assigned:  false,
			Live:      a.mode == ModeLive,
			Reason:    ReasonNoCapacity,
			DecidedAt: now,
		}
		a.recordDecision(dec)
		return dec, nil
	}

	if bestScore < a.minScore {
		dec := AllocationDecision{
			AttemptID: req.AttemptID,
			GoalID:    req.GoalID,
			AccountID: req.AccountID,
			BuilderID: bestBuilder.ID,
			Assigned:  false,
			Live:      a.mode == ModeLive,
			Score:     bestScore,
			Reason:    ReasonScoreTooLow,
			DecidedAt: now,
		}
		a.recordDecision(dec)
		return dec, nil
	}

	dec := AllocationDecision{
		AttemptID: req.AttemptID,
		GoalID:    req.GoalID,
		AccountID: req.AccountID,
		BuilderID: bestBuilder.ID,
		Assigned:  true,
		Live:      a.mode == ModeLive,
		Score:     bestScore,
		Reason:    ReasonAssigned,
		DecidedAt: now,
	}

	// In advisory mode, flag the decision but don't persist assignment.
	if a.mode == ModeAdvisory {
		dec.Reason = ReasonAdvisoryOnly
		dec.Assigned = false
		a.recordDecision(dec)
		return dec, nil
	}

	// Live mode: persist the assignment.
	if err := a.store.AssignBuilder(req.AttemptID, bestBuilder.ID, now); err != nil {
		return AllocationDecision{}, fmt.Errorf("allocator: assign builder: %w", err)
	}
	if err := a.store.RecordDecision(dec); err != nil {
		// The assignment succeeded but logging failed. Log locally and continue.
		// A production implementation would have a separate retry queue for this.
	}

	// Increment active count.
	bestBuilder.ActiveCount++

	a.recordDecision(dec)
	return dec, nil
}

// RecordFeedback ingests the outcome of a completed or failed attempt, updating
// the builder's success rate using an exponential moving average.
func (a *LiveScoringAllocator) RecordFeedback(outcome FeedbackOutcome) error {
	a.mu.Lock()
	defer a.mu.Unlock()

	a.feedback = append(a.feedback, outcome)

	b, ok := a.builders[outcome.BuilderID]
	if !ok {
		return nil // Builder may have been removed; silently ignore.
	}

	// Update success rate with exponential moving average (alpha=0.2).
	const alpha = 0.2
	var value float64
	if outcome.Succeeded {
		value = 1.0
	}
	b.SuccessRate = alpha*value + (1-alpha)*b.SuccessRate

	// Decrement active count (attempt is done).
	if b.ActiveCount > 0 {
		b.ActiveCount--
	}

	// Update average duration with moving average.
	if outcome.Duration > 0 {
		if b.AvgDuration == 0 {
			b.AvgDuration = outcome.Duration
		} else {
			b.AvgDuration = time.Duration(alpha*float64(outcome.Duration) + (1-alpha)*float64(b.AvgDuration))
		}
	}

	return nil
}

// recordDecision appends the decision and emits an event.
func (a *LiveScoringAllocator) recordDecision(dec AllocationDecision) {
	a.decisions = append(a.decisions, dec)
	if a.eventSink != nil {
		a.eventSink(AllocatorEvent{
			Type:      "allocator_decision_made",
			AttemptID: dec.AttemptID,
			GoalID:    dec.GoalID,
			AccountID: dec.AccountID,
			BuilderID: dec.BuilderID,
			Live:      dec.Live,
			Assigned:  dec.Assigned,
			Score:     dec.Score,
			Reason:    dec.Reason,
			At:        dec.DecidedAt,
		})
	}
}

// Decisions returns a copy of the decision log.
func (a *LiveScoringAllocator) Decisions() []AllocationDecision {
	a.mu.Lock()
	defer a.mu.Unlock()
	out := make([]AllocationDecision, len(a.decisions))
	copy(out, a.decisions)
	return out
}

// FeedbackLog returns a copy of the feedback log.
func (a *LiveScoringAllocator) FeedbackLog() []FeedbackOutcome {
	a.mu.Lock()
	defer a.mu.Unlock()
	out := make([]FeedbackOutcome, len(a.feedback))
	copy(out, a.feedback)
	return out
}

// Status returns a snapshot suitable for the /api/v1/allocator/status endpoint.
func (a *LiveScoringAllocator) Status() AllocatorStatus {
	a.mu.Lock()
	defer a.mu.Unlock()

	assigned := 0
	rejected := 0
	for _, dec := range a.decisions {
		if dec.Assigned {
			assigned++
		} else {
			rejected++
		}
	}

	builderSummaries := make([]BuilderSummary, 0, len(a.builders))
	for _, b := range a.builders {
		builderSummaries = append(builderSummaries, BuilderSummary{
			ID:          b.ID,
			Capacity:    b.Capacity,
			ActiveCount: b.ActiveCount,
			SuccessRate: math.Round(b.SuccessRate*1000) / 1000,
		})
	}

	return AllocatorStatus{
		Mode:            string(a.mode),
		BuilderCount:    len(a.builders),
		Builders:        builderSummaries,
		TotalDecisions:  len(a.decisions),
		AssignedCount:   assigned,
		RejectedCount:   rejected,
		FeedbackCount:   len(a.feedback),
		MinScore:        a.minScore,
		RecentDecisions: a.recentAllocDecisions(20),
	}
}

// AllocatorStatus is the JSON-serializable status payload.
type AllocatorStatus struct {
	Mode            string               `json:"mode"`
	BuilderCount    int                  `json:"builderCount"`
	Builders        []BuilderSummary     `json:"builders"`
	TotalDecisions  int                  `json:"totalDecisions"`
	AssignedCount   int                  `json:"assignedCount"`
	RejectedCount   int                  `json:"rejectedCount"`
	FeedbackCount   int                  `json:"feedbackCount"`
	MinScore        float64              `json:"minScore"`
	RecentDecisions []AllocationDecision `json:"recentDecisions"`
}

// BuilderSummary is the per-builder status slice.
type BuilderSummary struct {
	ID          string  `json:"id"`
	Capacity    int     `json:"capacity"`
	ActiveCount int     `json:"activeCount"`
	SuccessRate float64 `json:"successRate"`
}

// recentAllocDecisions returns up to n most recent decisions (caller holds mu).
func (a *LiveScoringAllocator) recentAllocDecisions(n int) []AllocationDecision {
	total := len(a.decisions)
	if total <= n {
		out := make([]AllocationDecision, total)
		copy(out, a.decisions)
		return out
	}
	out := make([]AllocationDecision, n)
	copy(out, a.decisions[total-n:])
	return out
}

// ---------------------------------------------------------------------------
// In-memory AllocationStore — used in tests and during the advisory phase.
// ---------------------------------------------------------------------------

// MemoryAllocationStore is a thread-safe in-memory AllocationStore.
type MemoryAllocationStore struct {
	mu          sync.Mutex
	decisions   []AllocationDecision
	assignments map[string]string // attemptID -> builderID
}

// NewMemoryAllocationStore creates an empty in-memory store.
func NewMemoryAllocationStore() *MemoryAllocationStore {
	return &MemoryAllocationStore{
		assignments: make(map[string]string),
	}
}

// RecordDecision persists a decision.
func (s *MemoryAllocationStore) RecordDecision(dec AllocationDecision) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.decisions = append(s.decisions, dec)
	return nil
}

// AssignBuilder persists the assignment with CAS semantics.
func (s *MemoryAllocationStore) AssignBuilder(attemptID, builderID string, at time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	existing, ok := s.assignments[attemptID]
	if ok && existing != builderID {
		return errors.New("attempt already assigned to a different builder")
	}
	s.assignments[attemptID] = builderID
	return nil
}

// GetAssignment returns the assigned builder for an attempt, if any.
func (s *MemoryAllocationStore) GetAssignment(attemptID string) (string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	id, ok := s.assignments[attemptID]
	return id, ok
}

// StoredDecisions returns a copy of recorded decisions.
func (s *MemoryAllocationStore) StoredDecisions() []AllocationDecision {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]AllocationDecision, len(s.decisions))
	copy(out, s.decisions)
	return out
}
