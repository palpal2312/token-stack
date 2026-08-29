package community

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sync"
	"time"
)

// Store defines the community queue persistence boundary.
type Store interface {
	Enqueue(item QueueItem) error
	IngestExportCandidate(candidate ProductExportCandidate) (*QueueItem, error)
	Get(id string) (*QueueItem, error)
	ListPending() ([]QueueItem, error)
	Transition(id string, nextState ItemState) error
	Quarantine(id string, reason, violationCode string) error
	Export(id string) (*ExportEnvelope, error)
}

// MemoryCommunityStore is an in-memory crash/replay safe store.
type MemoryCommunityStore struct {
	mu         sync.Mutex
	items      map[string]*QueueItem
	itemsBySeq map[int64]*QueueItem
	nextSeq    int64
}

// NewMemoryCommunityStore creates a new in-memory community queue store.
func NewMemoryCommunityStore() *MemoryCommunityStore {
	return &MemoryCommunityStore{
		items:      make(map[string]*QueueItem),
		itemsBySeq: make(map[int64]*QueueItem),
		nextSeq:    1,
	}
}

// Enqueue inserts a new item into the queue in StateDraft or StateQueued.
func (s *MemoryCommunityStore) Enqueue(item QueueItem) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if err := ValidateItemSanity(&item); err != nil {
		return fmt.Errorf("item validation failed: %w", err)
	}

	if _, exists := s.items[item.ID]; exists {
		return fmt.Errorf("item with id %q already exists", item.ID)
	}

	if item.Status == "" {
		if item.State != "" {
			item.Status = item.State
		} else {
			item.Status = StatusPending
		}
	}
	if item.State == "" {
		item.State = item.Status
	}
	item.State = item.Status

	if item.Seq == 0 {
		item.Seq = s.nextSeq
		s.nextSeq++
	}
	now := time.Now().UTC()
	if item.CreatedAt.IsZero() {
		item.CreatedAt = now
	}
	item.UpdatedAt = now

	clone := item
	s.items[item.ID] = &clone
	s.itemsBySeq[item.Seq] = &clone
	return nil
}

// IngestExportCandidate ingests an AO-14 ProductExportCandidate into the queue.
// Invariants:
// - No plugin_slug or author_ref requirement.
// - Idempotent replay: if already exists with same ID or content hash, return existing.
// - Quarantine on validation/sanitization failure without queue disruption.
func (s *MemoryCommunityStore) IngestExportCandidate(candidate ProductExportCandidate) (*QueueItem, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if candidate.ID == "" {
		return nil, fmt.Errorf("candidate ID cannot be empty")
	}

	// Idempotent check by ID
	if existing, ok := s.items[candidate.ID]; ok {
		clone := *existing
		return &clone, nil
	}

	// Idempotent check by PayloadHash / ContentHash
	if candidate.ContentHash != "" {
		for _, item := range s.items {
			if item.PayloadHash == candidate.ContentHash {
				clone := *item
				return &clone, nil
			}
		}
	}

	now := time.Now().UTC()
	createdAt := candidate.CreatedAt
	if createdAt.IsZero() {
		createdAt = now
	}

	payloadHash := candidate.ContentHash
	if payloadHash == "" {
		if candidate.RawPayload != "" {
			h := sha256.Sum256([]byte(candidate.RawPayload))
			payloadHash = hex.EncodeToString(h[:])
		} else {
			payloadHash = fmt.Sprintf("hash-%s", candidate.ID)
		}
	}

	item := QueueItem{
		ID:          candidate.ID,
		Source:      candidate.SourceType,
		PayloadHash: payloadHash,
		RawPayload:  candidate.RawPayload,
		Status:      StatusPending,
		State:       StatusPending,
		Seq:         s.nextSeq,
		CreatedAt:   createdAt,
		UpdatedAt:   now,
		Metadata:    candidate.Metadata,
	}
	if item.Source == "" {
		item.Source = "sen-product.db"
	}
	s.nextSeq++

	// Check raw payload and metadata for secrets/allowlist
	rawErr := ValidateRawPayload(candidate.RawPayload)
	cleanMeta, metaErr := ValidateAndSanitizeMetadata(candidate.Metadata)

	if rawErr != nil || metaErr != nil {
		reason := "sanitization validation failure"
		if rawErr != nil {
			reason = rawErr.Error()
		} else if metaErr != nil {
			reason = metaErr.Error()
		}
		item.Status = StatusQuarantined
		item.State = StatusQuarantined
		item.QuarantineReason = &reason
		item.QuarantineRef = &QuarantineRef{
			Reason:        reason,
			ViolationCode: "ERR_SANITIZATION_FAILED",
			QuarantinedAt: now,
		}
		item.ProcessedAt = &now
	} else {
		item.Metadata = cleanMeta
	}

	clone := item
	s.items[item.ID] = &clone
	s.itemsBySeq[item.Seq] = &clone
	return &clone, nil
}

// Get retrieves an item by ID.
func (s *MemoryCommunityStore) Get(id string) (*QueueItem, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	item, ok := s.items[id]
	if !ok {
		return nil, nil
	}
	clone := *item
	return &clone, nil
}

// ListPending returns all items currently queued, sanitizing, or approved.
// Invariant: Quarantined items are excluded from pending processing to avoid blocking.
func (s *MemoryCommunityStore) ListPending() ([]QueueItem, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	var pending []QueueItem
	for _, item := range s.items {
		if item.Status == StatusPending || item.Status == StatusSanitizing || item.Status == StatusSanitized {
			pending = append(pending, *item)
		}
	}
	return pending, nil
}

// Transition moves an item to the next state according to ValidTransitions.
func (s *MemoryCommunityStore) Transition(id string, nextState ItemState) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	item, ok := s.items[id]
	if !ok {
		return fmt.Errorf("item %q not found", id)
	}

	allowed := ValidTransitions[item.Status]
	valid := false
	for _, st := range allowed {
		if st == nextState {
			valid = true
			break
		}
	}
	if !valid {
		return fmt.Errorf("invalid transition %q -> %q for item %s", item.Status, nextState, id)
	}

	item.Status = nextState
	item.State = nextState
	item.UpdatedAt = time.Now().UTC()
	return nil
}

// Quarantine isolates a bad/violating record.
// Invariant: It does NOT delete or block other items in the queue.
func (s *MemoryCommunityStore) Quarantine(id string, reason, violationCode string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	item, ok := s.items[id]
	if !ok {
		return fmt.Errorf("item %q not found", id)
	}

	if item.Status == StatusRejected {
		return fmt.Errorf("cannot quarantine terminal rejected item %q", id)
	}

	// Idempotent retry when already quarantined
	if item.Status == StatusQuarantined {
		if item.QuarantineRef != nil && item.QuarantineRef.Reason == reason && item.QuarantineRef.ViolationCode == violationCode {
			return nil
		}
		if violationCode == "" && item.QuarantineRef != nil && item.QuarantineRef.Reason == reason {
			return nil
		}
		return fmt.Errorf("item %q already quarantined with incompatible reason %q", id, item.QuarantineRef.Reason)
	}

	allowed := ValidTransitions[item.Status]
	valid := false
	for _, st := range allowed {
		if st == StatusQuarantined {
			valid = true
			break
		}
	}
	if !valid {
		return fmt.Errorf("invalid transition %q -> %q for item %s", item.Status, StatusQuarantined, id)
	}

	now := time.Now().UTC()
	item.Status = StatusQuarantined
	item.State = StatusQuarantined
	item.QuarantineReason = &reason
	item.QuarantineRef = &QuarantineRef{
		Reason:        reason,
		ViolationCode: violationCode,
		QuarantinedAt: now,
	}
	item.ProcessedAt = &now
	item.UpdatedAt = now
	return nil
}

// Export builds an export envelope and transitions the state to StateExported.
func (s *MemoryCommunityStore) Export(id string) (*ExportEnvelope, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	item, ok := s.items[id]
	if !ok {
		return nil, fmt.Errorf("item %q not found", id)
	}

	if item.Status != StatusPending && item.Status != StatusSanitizing && item.Status != StatusSanitized {
		return nil, fmt.Errorf("item %s must be in pending, sanitizing, or sanitized status to export (current: %s)", id, item.Status)
	}

	envelope, err := BuildExportEnvelope(item)
	if err != nil {
		return nil, err
	}

	item.Status = StatusSanitized
	item.State = StatusSanitized
	item.UpdatedAt = time.Now().UTC()
	return envelope, nil
}
