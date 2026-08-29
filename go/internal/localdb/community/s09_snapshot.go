package community

// S09 Community Knowledge Snapshot return (Contract v1, hash-pinned 2026-08-28, arbiter GO).
//
// Advisory-only import of Ed25519-signed CommunityKnowledgeSnapshot records.
// Verification uses a runtime-supplied allowlisted keyId → public-key registry;
// private signing keys are never stored in the repository. Invalid, expired, or
// unknown-key snapshots are rejected with no state change. Successful import
// stores the prior version for atomic reversible rollback. This path has no
// execution or publication authority and never mutates canonical product state.
//
// Persistence reuses the frozen S08 runlearning append-only JSONL journal
// pattern so no shared migration or DTO registration change is required.
// Legacy writer stays disabled; Phase 21 stays blocked.

import (
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"agentic-os/internal/runlearning"
)

const (
	// S09MaxSnapshotBytes bounds a single snapshot import (fail closed 413).
	S09MaxSnapshotBytes = 256 << 10
	// S09SnapshotAuthority marks imported snapshots as advisory-only.
	S09SnapshotAuthority = "advisory-only"
)

// S09KeyRegistry is the runtime-supplied allowlist of keyId → Ed25519 public key.
// Private keys must never appear here or in the repository.
type S09KeyRegistry map[string]ed25519.PublicKey

// CommunityKnowledgeSnapshot is the frozen S09 snapshot record.
type CommunityKnowledgeSnapshot struct {
	SnapshotID      string          `json:"snapshotId"`
	SchemaVersion   string          `json:"schemaVersion"`
	SnapshotVersion int64           `json:"snapshotVersion"`
	Cohort          string          `json:"cohort"`
	Facts           json.RawMessage `json:"facts"`
	SampleSize      int             `json:"sampleSize"`
	Uncertainty     float64         `json:"uncertainty"`
	ValidFrom       time.Time       `json:"validFrom"`
	ExpiresAt       time.Time       `json:"expiresAt"`
	KeyID           string          `json:"keyId"`
	Signature       string          `json:"signature"`
	RollbackVersion int64           `json:"rollbackVersion"`
}

// s09SnapshotSignBody is the canonical signing payload: every frozen field
// except signature, in struct field order (deterministic json.Marshal).
type s09SnapshotSignBody struct {
	SnapshotID      string          `json:"snapshotId"`
	SchemaVersion   string          `json:"schemaVersion"`
	SnapshotVersion int64           `json:"snapshotVersion"`
	Cohort          string          `json:"cohort"`
	Facts           json.RawMessage `json:"facts"`
	SampleSize      int             `json:"sampleSize"`
	Uncertainty     float64         `json:"uncertainty"`
	ValidFrom       time.Time       `json:"validFrom"`
	ExpiresAt       time.Time       `json:"expiresAt"`
	KeyID           string          `json:"keyId"`
	RollbackVersion int64           `json:"rollbackVersion"`
}

// S09SnapshotRequest is the ingress envelope (untrusted).
type S09SnapshotRequest struct {
	SchemaVersion string                      `json:"schemaVersion"`
	RequestID     string                      `json:"requestId"`
	Provenance    runlearning.Provenance      `json:"provenance"`
	Snapshot      CommunityKnowledgeSnapshot  `json:"snapshot"`
}

// S09SnapshotResponse is the frozen {schemaVersion, requestId, result, error}
// API envelope.
type S09SnapshotResponse struct {
	SchemaVersion string                     `json:"schemaVersion"`
	RequestID     string                     `json:"requestId"`
	Result        *CommunityKnowledgeSnapshot `json:"result,omitempty"`
	Error         *runlearning.SafeError     `json:"error,omitempty"`
	Authority     string                     `json:"authority,omitempty"`
}

// s09SnapshotJournal is one durable advisory-store checkpoint.
type s09SnapshotJournal struct {
	Current *CommunityKnowledgeSnapshot `json:"current,omitempty"`
	Prior   *CommunityKnowledgeSnapshot `json:"prior,omitempty"`
}

// S09SnapshotStore holds the current advisory snapshot and one prior version
// for atomic rollback. It never grants execution or publication authority.
type S09SnapshotStore struct {
	mu      sync.Mutex
	journal *os.File
	keys    S09KeyRegistry
	current *CommunityKnowledgeSnapshot
	prior   *CommunityKnowledgeSnapshot
}

// NewS09SnapshotStore returns an in-memory advisory snapshot store.
func NewS09SnapshotStore(keys S09KeyRegistry) *S09SnapshotStore {
	if keys == nil {
		keys = S09KeyRegistry{}
	}
	return &S09SnapshotStore{keys: keys}
}

// OpenS09SnapshotStore rebuilds advisory state from the append-only journal.
func OpenS09SnapshotStore(path string, keys S09KeyRegistry) (*S09SnapshotStore, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	b, err := os.ReadFile(path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	lastNewline := bytes.LastIndexByte(b, '\n')
	complete := b
	if len(b) > 0 && lastNewline != len(b)-1 {
		if lastNewline < 0 {
			complete = nil
		} else {
			complete = b[:lastNewline+1]
		}
	}
	s := NewS09SnapshotStore(keys)
	for _, line := range bytes.Split(complete, []byte{'\n'}) {
		if len(bytes.TrimSpace(line)) == 0 {
			continue
		}
		var snap s09SnapshotJournal
		if err := json.Unmarshal(line, &snap); err != nil {
			return nil, fmt.Errorf("rebuild durable s09 snapshot state: %w", err)
		}
		s.current = snap.Current
		s.prior = snap.Prior
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err := f.Truncate(int64(len(complete))); err != nil {
		f.Close()
		return nil, err
	}
	if _, err := f.Seek(0, 2); err != nil {
		f.Close()
		return nil, err
	}
	s.journal = f
	return s, nil
}

// Close closes the journal.
func (s *S09SnapshotStore) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.journal == nil {
		return nil
	}
	err := s.journal.Close()
	s.journal = nil
	return err
}

// Current returns a clone of the active advisory snapshot, or nil.
func (s *S09SnapshotStore) Current() *CommunityKnowledgeSnapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	return cloneSnapshot(s.current)
}

// Prior returns a clone of the stored prior version, or nil.
func (s *S09SnapshotStore) Prior() *CommunityKnowledgeSnapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	return cloneSnapshot(s.prior)
}

func cloneSnapshot(in *CommunityKnowledgeSnapshot) *CommunityKnowledgeSnapshot {
	if in == nil {
		return nil
	}
	out := *in
	if in.Facts != nil {
		out.Facts = append(json.RawMessage(nil), in.Facts...)
	}
	return &out
}

func (s *S09SnapshotStore) persistLocked() error {
	if s.journal == nil {
		return nil
	}
	b, err := json.Marshal(s09SnapshotJournal{Current: s.current, Prior: s.prior})
	if err != nil {
		return err
	}
	b = append(b, '\n')
	if _, err := s.journal.Write(b); err != nil {
		return err
	}
	return s.journal.Sync()
}

// S09CanonicalSnapshotBytes returns deterministic JSON bytes of the snapshot
// signing body (all frozen fields except signature).
func S09CanonicalSnapshotBytes(snap CommunityKnowledgeSnapshot) ([]byte, error) {
	facts := snap.Facts
	if facts == nil {
		facts = json.RawMessage("null")
	}
	body := s09SnapshotSignBody{
		SnapshotID:      snap.SnapshotID,
		SchemaVersion:   snap.SchemaVersion,
		SnapshotVersion: snap.SnapshotVersion,
		Cohort:          snap.Cohort,
		Facts:           facts,
		SampleSize:      snap.SampleSize,
		Uncertainty:     snap.Uncertainty,
		ValidFrom:       snap.ValidFrom.UTC(),
		ExpiresAt:       snap.ExpiresAt.UTC(),
		KeyID:           snap.KeyID,
		RollbackVersion: snap.RollbackVersion,
	}
	return json.Marshal(body)
}

// S09SignSnapshot canonicalizes facts then signs with an in-memory Ed25519
// private key. Callers must supply the key at runtime; keys are never read
// from the repository.
func S09SignSnapshot(snap *CommunityKnowledgeSnapshot, priv ed25519.PrivateKey) error {
	if snap == nil {
		return errors.New("nil snapshot")
	}
	if len(priv) != ed25519.PrivateKeySize {
		return errors.New("invalid ed25519 private key")
	}
	canonicalFacts, e := s09ValidateSnapshotFacts(snap.Facts)
	if e != nil {
		return e
	}
	snap.Facts = canonicalFacts
	snap.ValidFrom = snap.ValidFrom.UTC()
	snap.ExpiresAt = snap.ExpiresAt.UTC()
	canonical, err := S09CanonicalSnapshotBytes(*snap)
	if err != nil {
		return err
	}
	sig := ed25519.Sign(priv, canonical)
	snap.Signature = base64.StdEncoding.EncodeToString(sig)
	return nil
}

func s09VerifySnapshotSignature(snap CommunityKnowledgeSnapshot, pub ed25519.PublicKey) *runlearning.SafeError {
	if len(pub) != ed25519.PublicKeySize {
		return s09Err("policy_rejected", "unknown-key", "$/snapshot/keyId")
	}
	canonical, err := S09CanonicalSnapshotBytes(snap)
	if err != nil {
		return s09Err("invalid_payload", "canonical-json", "$/snapshot")
	}
	sig, err := base64.StdEncoding.DecodeString(snap.Signature)
	if err != nil || len(sig) != ed25519.SignatureSize {
		return s09Err("policy_rejected", "signature", "$/snapshot/signature")
	}
	if !ed25519.Verify(pub, canonical, sig) {
		return s09Err("policy_rejected", "signature", "$/snapshot/signature")
	}
	return nil
}

func s09ValidateSnapshotFacts(raw json.RawMessage) (json.RawMessage, *runlearning.SafeError) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, s09Err("invalid_payload", "facts", "$/snapshot/facts")
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	var facts []NormalizedFact
	if err := dec.Decode(&facts); err != nil {
		return nil, s09Err("invalid_payload", "facts-shape", "$/snapshot/facts")
	}
	if len(facts) == 0 {
		return nil, s09Err("invalid_payload", "facts-empty", "$/snapshot/facts")
	}
	for i, f := range facts {
		ptr := fmt.Sprintf("$/snapshot/facts/%d", i)
		if f.SchemaVersion != S09SchemaVersion {
			return nil, s09Err("invalid_payload", "schema-version", ptr+"/schemaVersion")
		}
		for _, l := range []struct{ v, p string }{
			{f.FactID, ptr + "/factId"},
			{f.Cohort, ptr + "/cohort"},
			{f.Signature, ptr + "/signature"},
		} {
			if e := s09ValidateLabel(l.v, l.p); e != nil {
				return nil, e
			}
		}
		if f.Count < 1 || f.SampleSize < 0 || f.Uncertainty < 0 || f.Uncertainty > 1 {
			return nil, s09Err("invalid_payload", "evidence-quality", ptr)
		}
	}
	canonical, err := json.Marshal(facts)
	if err != nil {
		return nil, s09Err("invalid_payload", "facts-shape", "$/snapshot/facts")
	}
	return canonical, nil
}

// Import validates and advisory-imports a signed CommunityKnowledgeSnapshot.
// Failures leave store state unchanged.
func (s *S09SnapshotStore) Import(raw []byte, now time.Time) S09SnapshotResponse {
	resp := S09SnapshotResponse{
		SchemaVersion: S09SchemaVersion,
		Authority:     S09SnapshotAuthority,
	}
	fail := func(e *runlearning.SafeError) S09SnapshotResponse {
		resp.Error = e
		return resp
	}

	if len(raw) > S09MaxSnapshotBytes {
		return fail(s09Err("size_limit", "request-size", "$"))
	}
	var rawMap map[string]any
	if err := json.Unmarshal(raw, &rawMap); err != nil {
		return fail(s09Err("invalid_payload", "json-syntax", "$"))
	}
	if e := s09WalkRaw(rawMap, "$", S09PolicyRevision); e != nil {
		return fail(e)
	}

	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	var req S09SnapshotRequest
	if err := dec.Decode(&req); err != nil {
		return fail(s09Err("invalid_payload", "envelope-shape", "$"))
	}
	resp.RequestID = req.RequestID
	if req.SchemaVersion != S09SchemaVersion || req.RequestID == "" {
		return fail(s09Err("invalid_payload", "schema-version", "$/schemaVersion"))
	}
	// Provenance required on import envelope (contract gate).
	if req.Provenance.Producer == "" || req.Provenance.DerivationRevision == "" || req.Provenance.ObservedAt.IsZero() {
		return fail(s09Err("invalid_payload", "provenance", "$/provenance"))
	}
	if e := s09ValidateLabel(req.Provenance.Producer, "$/provenance/producer"); e != nil {
		return fail(e)
	}
	if e := s09ValidateLabel(req.Provenance.DerivationRevision, "$/provenance/derivationRevision"); e != nil {
		return fail(e)
	}

	snap := req.Snapshot
	if snap.SchemaVersion != S09SchemaVersion || snap.SnapshotID == "" {
		return fail(s09Err("invalid_payload", "schema-version", "$/snapshot/schemaVersion"))
	}
	if e := s09ValidateLabel(snap.SnapshotID, "$/snapshot/snapshotId"); e != nil {
		return fail(e)
	}
	if e := s09ValidateLabel(snap.Cohort, "$/snapshot/cohort"); e != nil {
		return fail(e)
	}
	if snap.SnapshotVersion < 1 {
		return fail(s09Err("invalid_payload", "snapshot-version", "$/snapshot/snapshotVersion"))
	}
	if snap.RollbackVersion < 0 {
		return fail(s09Err("invalid_payload", "rollback-reference", "$/snapshot/rollbackVersion"))
	}
	if snap.SampleSize < 0 || snap.Uncertainty < 0 || snap.Uncertainty > 1 {
		return fail(s09Err("invalid_payload", "evidence-quality", "$/snapshot"))
	}
	if snap.ValidFrom.IsZero() || snap.ExpiresAt.IsZero() || !snap.ExpiresAt.After(snap.ValidFrom) {
		return fail(s09Err("invalid_payload", "validity-window", "$/snapshot/expiresAt"))
	}

	nowUTC := now.UTC()
	if nowUTC.Before(snap.ValidFrom.UTC()) || !nowUTC.Before(snap.ExpiresAt.UTC()) {
		return fail(s09Err("policy_rejected", "expired", "$/snapshot/expiresAt"))
	}

	if snap.KeyID == "" {
		return fail(s09Err("policy_rejected", "unknown-key", "$/snapshot/keyId"))
	}
	pub, ok := s.keys[snap.KeyID]
	if !ok {
		return fail(s09Err("policy_rejected", "unknown-key", "$/snapshot/keyId"))
	}

	// Canonicalize facts before signature check so verification binds the
	// stored advisory record, not raw ingress whitespace.
	canonicalFacts, e := s09ValidateSnapshotFacts(snap.Facts)
	if e != nil {
		return fail(e)
	}
	snap.Facts = canonicalFacts
	snap.ValidFrom = snap.ValidFrom.UTC()
	snap.ExpiresAt = snap.ExpiresAt.UTC()
	if e := s09VerifySnapshotSignature(snap, pub); e != nil {
		return fail(e)
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	// Monotonic snapshot version + rollback reference to the live prior.
	if s.current == nil {
		if snap.RollbackVersion != 0 {
			return fail(s09Err("invalid_payload", "rollback-reference", "$/snapshot/rollbackVersion"))
		}
	} else {
		if snap.SnapshotVersion <= s.current.SnapshotVersion {
			return fail(s09Err("duplicate_or_conflict", "snapshot-version", "$/snapshot/snapshotVersion"))
		}
		if snap.RollbackVersion != s.current.SnapshotVersion {
			return fail(s09Err("invalid_payload", "rollback-reference", "$/snapshot/rollbackVersion"))
		}
	}

	prevCurrent := s.current
	prevPrior := s.prior
	s.prior = cloneSnapshot(s.current)
	s.current = cloneSnapshot(&snap)
	if err := s.persistLocked(); err != nil {
		s.current = prevCurrent
		s.prior = prevPrior
		return fail(s09Err("unavailable", "persistence", "$"))
	}
	resp.Result = cloneSnapshot(s.current)
	return resp
}

// Rollback atomically restores the stored prior advisory snapshot.
// Fails closed with no state change when no prior version exists.
func (s *S09SnapshotStore) Rollback(requestID string, now time.Time) S09SnapshotResponse {
	_ = now
	resp := S09SnapshotResponse{
		SchemaVersion: S09SchemaVersion,
		RequestID:     requestID,
		Authority:     S09SnapshotAuthority,
	}
	fail := func(e *runlearning.SafeError) S09SnapshotResponse {
		resp.Error = e
		return resp
	}
	if requestID == "" {
		return fail(s09Err("invalid_payload", "request-id", "$/requestId"))
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if s.prior == nil {
		return fail(s09Err("invalid_payload", "no-prior", "$/rollback"))
	}

	prevCurrent := s.current
	prevPrior := s.prior
	s.current = cloneSnapshot(s.prior)
	s.prior = nil
	if err := s.persistLocked(); err != nil {
		s.current = prevCurrent
		s.prior = prevPrior
		return fail(s09Err("unavailable", "persistence", "$"))
	}
	resp.Result = cloneSnapshot(s.current)
	return resp
}
