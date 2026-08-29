package community

// S09 community intake (Contract v1, hash-pinned 2026-08-28, arbiter GO).
//
// Privacy-safe intake of allowlisted runlearning.ForecastFeatureRecord values
// and normalized incident/evaluation facts only. Every candidate lands in
// quarantine before review, consent/provenance/idempotency are enforced, and
// forbidden raw project/private fields are rejected BEFORE persistence. The
// raw ingress payload is never persisted: only the strict-decoded,
// re-marshaled normalized record is stored. Reject/delete/export are
// reversible, audited moderation transitions.
//
// Persistence reuses the frozen S08 runlearning journal pattern (append-only
// JSONL snapshot log) so no shared migration or DTO registration change is
// required. Legacy writer stays disabled; Phase 21 stays blocked.

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"agentic-os/internal/runlearning"
)

const (
	// S09SchemaVersion is the frozen envelope schema version for S09 intake.
	S09SchemaVersion = "1.0.0"
	// S09PolicyRevision is the policy revision stamped on S09 safe errors.
	S09PolicyRevision = "s09-1"
	// S09MaxIntakeBytes bounds a single intake request (fail closed 413).
	S09MaxIntakeBytes = 64 << 10
)

// Source classes allowlisted for S09 intake (contract: ForecastFeatureRecord
// and normalized incident/evaluation facts only).
const (
	S09SourceForecastFeature = "forecast_feature_record"
	S09SourceIncidentFact    = "normalized_incident_fact"
	S09SourceEvaluationFact  = "normalized_evaluation_fact"
)

// S09CandidateStatus is the quarantine-first moderation lifecycle. All
// transitions are audited; reject/delete/quarantine are reversible.
type S09CandidateStatus string

const (
	S09StatusQuarantined S09CandidateStatus = "quarantined" // intake lands here, before review
	S09StatusUnderReview S09CandidateStatus = "under_review"
	S09StatusAccepted    S09CandidateStatus = "accepted"
	S09StatusRejected    S09CandidateStatus = "rejected"   // reversible via -> quarantined
	S09StatusTombstoned  S09CandidateStatus = "tombstoned" // delete; reversible via -> quarantined
)

// s09ModerationTransitions is the reversible moderation state machine.
var s09ModerationTransitions = map[S09CandidateStatus][]S09CandidateStatus{
	S09StatusQuarantined: {S09StatusUnderReview, S09StatusRejected, S09StatusTombstoned},
	S09StatusUnderReview: {S09StatusQuarantined, S09StatusAccepted, S09StatusRejected},
	S09StatusAccepted:    {S09StatusQuarantined, S09StatusRejected},
	S09StatusRejected:    {S09StatusQuarantined, S09StatusTombstoned},
	S09StatusTombstoned:  {S09StatusQuarantined},
}

// S09Candidate is the frozen S09 ContributionCandidate record. Payload holds
// ONLY the strict-decoded, re-marshaled normalized allowlisted record.
type S09Candidate struct {
	ID              string                 `json:"id"`
	SchemaVersion   string                 `json:"schemaVersion"`
	IdempotencyKey  string                 `json:"idempotencyKey"`
	ConsentID       string                 `json:"consentId"`
	ActorIDHash     string                 `json:"actorIdHash"`
	WorkspaceIDHash string                 `json:"workspaceIdHash"`
	SourceClass     string                 `json:"sourceClass"`
	Payload         json.RawMessage        `json:"payload"`
	PayloadSha256   string                 `json:"payloadSha256"`
	Provenance      runlearning.Provenance `json:"provenance"`
	CreatedAt       time.Time              `json:"createdAt"`
	Status          S09CandidateStatus     `json:"status"`
}

// NormalizedFact is the S09 NormalizedIncidentFact / normalized evaluation
// fact shape: content-free labels plus bounded numeric aggregates.
type NormalizedFact struct {
	SchemaVersion string  `json:"schemaVersion"`
	FactID        string  `json:"factId"`
	Cohort        string  `json:"cohort"`
	Signature     string  `json:"signature"`
	Count         int     `json:"count"`
	SampleSize    int     `json:"sampleSize"`
	Uncertainty   float64 `json:"uncertainty"`
}

// S09IntakeRequest is the ingress envelope (untrusted).
type S09IntakeRequest struct {
	SchemaVersion   string                 `json:"schemaVersion"`
	RequestID       string                 `json:"requestId"`
	IdempotencyKey  string                 `json:"idempotencyKey"`
	ConsentID       string                 `json:"consentId"`
	ActorIDHash     string                 `json:"actorIdHash"`
	WorkspaceIDHash string                 `json:"workspaceIdHash"`
	SourceClass     string                 `json:"sourceClass"`
	Provenance      runlearning.Provenance `json:"provenance"`
	Payload         json.RawMessage        `json:"payload"`
}

// S09IntakeResponse is the frozen {schemaVersion, requestId, result, error}
// API envelope. Error codes fail closed per contract: invalid_payload,
// unauthenticated, consent_required, duplicate_or_conflict, size_limit,
// policy_rejected, unavailable.
type S09IntakeResponse struct {
	SchemaVersion string                `json:"schemaVersion"`
	RequestID     string                `json:"requestId"`
	Result        *S09Candidate         `json:"result,omitempty"`
	Error         *runlearning.SafeError `json:"error,omitempty"`
}

// S09AuditEvent is one durable moderation/audit transition. It never carries
// payload content, only hashes, states, and a content-free reason.
type S09AuditEvent struct {
	Seq         int64              `json:"seq"`
	CandidateID string             `json:"candidateId"`
	Event       string             `json:"event"` // intake | transition | export
	From        S09CandidateStatus `json:"from,omitempty"`
	To          S09CandidateStatus `json:"to,omitempty"`
	ActorIDHash string             `json:"actorIdHash"`
	Reason      string             `json:"reason"`
	At          time.Time          `json:"at"`
}

// S09ExportReceipt lets a user inspect the exact normalized payload and the
// removal/moderation state. Export does not mutate candidate status.
type S09ExportReceipt struct {
	ExportID      string              `json:"exportId"`
	SchemaVersion string              `json:"schemaVersion"`
	CandidateID   string              `json:"candidateId"`
	Status        S09CandidateStatus  `json:"status"`
	SourceClass   string              `json:"sourceClass"`
	Payload       json.RawMessage     `json:"payload"`
	PayloadSha256 string              `json:"payloadSha256"`
	ReceiptHash   string              `json:"receiptHash"`
	ExportedAt    time.Time           `json:"exportedAt"`
}

// ---------------------------------------------------------------------------
// Forbidden-field enforcement (S09 contract classes, pre-persistence)
// ---------------------------------------------------------------------------

// s09ForbiddenSingle matches contract forbidden classes as whole words after
// splitting keys on camelCase/snake/kebab boundaries.
var s09ForbiddenSingle = map[string]bool{
	"prompt": true, "conversation": true, "source": true, "diff": true,
	"repository": true, "path": true, "secret": true, "token": true,
	"credential": true,
}

// s09ForbiddenJoined matches multi-word classes (user_story, raw_log,
// personal_data, exact_private_identifier) on the separator-stripped key.
var s09ForbiddenJoined = []string{"userstory", "rawlog", "personaldata", "exactprivateidentifier"}

// s09ContractFields are frozen contract/S08 field names that legitimately
// contain a forbidden word segment. All are hash, reference, or bucket-label
// carriers, never raw content: sourceClass, provenance.sourceRecordIds, and
// the runlearning bucket criticalPathBucket.
var s09ContractFields = map[string]bool{
	"sourceclass": true, "sourcerecordids": true, "criticalpathbucket": true,
}

func s09NormKey(k string) string {
	return strings.Map(func(r rune) rune {
		if r >= 'A' && r <= 'Z' {
			return r + 32
		}
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, k)
}

// s09KeySegments splits a JSON key into lowercase word segments on
// camelCase, snake_case, and kebab boundaries.
func s09KeySegments(k string) []string {
	var segs []string
	var cur []rune
	prevLower := false
	for _, r := range k {
		switch {
		case r == '_' || r == '-' || r == ' ' || r == '.':
			if len(cur) > 0 {
				segs = append(segs, strings.ToLower(string(cur)))
				cur = nil
			}
			prevLower = false
		case r >= 'A' && r <= 'Z':
			if prevLower && len(cur) > 0 {
				segs = append(segs, strings.ToLower(string(cur)))
				cur = nil
			}
			cur = append(cur, r)
			prevLower = false
		default:
			cur = append(cur, r)
			prevLower = r >= 'a' && r <= 'z'
		}
	}
	if len(cur) > 0 {
		segs = append(segs, strings.ToLower(string(cur)))
	}
	return segs
}

// s09ForbiddenKey reports whether a JSON key names a forbidden raw
// project/private field class from the S09 contract.
func s09ForbiddenKey(key string) bool {
	norm := s09NormKey(key)
	if s09ContractFields[norm] {
		return false
	}
	for _, joined := range s09ForbiddenJoined {
		if strings.Contains(norm, joined) {
			return true
		}
	}
	for _, seg := range s09KeySegments(key) {
		if s09ForbiddenSingle[seg] || s09ForbiddenSingle[strings.TrimSuffix(seg, "s")] {
			return true
		}
	}
	return false
}

// s09PrivateValue reuses the community sanitizer secret shapes to catch
// bearer/JWT/PEM/secret values smuggled into free-form fields.
func s09PrivateValue(v string) bool {
	return bearerPattern.MatchString(v) || jwtPattern.MatchString(v) ||
		secretKeyPattern.MatchString(v) || pemKeyPattern.MatchString(v)
}

// s09WalkRaw recursively rejects forbidden fields/values in decoded ingress
// JSON before any persistence. ptr is a JSON-pointer for the safe error.
func s09WalkRaw(v any, ptr, policy string) *runlearning.SafeError {
	switch t := v.(type) {
	case map[string]any:
		for k, val := range t {
			if s09ForbiddenKey(k) {
				return s09Err("policy_rejected", "forbidden-field", ptr+"/"+k)
			}
			if e := s09WalkRaw(val, ptr+"/"+k, policy); e != nil {
				return e
			}
		}
	case []any:
		for i, val := range t {
			if e := s09WalkRaw(val, fmt.Sprintf("%s/%d", ptr, i), policy); e != nil {
				return e
			}
		}
	case string:
		if s09PrivateValue(t) {
			return s09Err("policy_rejected", "private-value", ptr)
		}
	}
	return nil
}

var (
	s09HashShape        = regexp.MustCompile(`^[0-9a-f]{64}$`)
	s09ContentFreeLabel = regexp.MustCompile(`^[a-z0-9]+(?:[-/][a-z0-9]+)*$`)
	s09ConsentShape     = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_:.\-]{0,127}$`)
)

func s09Err(code, class, ptr string) *runlearning.SafeError {
	h := sha256.Sum256([]byte(code + "|" + ptr + "|" + S09PolicyRevision))
	return &runlearning.SafeError{
		SchemaVersion: S09SchemaVersion, ErrorCode: code, RuleClass: class,
		FieldPointer: ptr, Retryable: false, PolicyRevision: S09PolicyRevision,
		CorrelationID: hex.EncodeToString(h[:8]),
	}
}

// ---------------------------------------------------------------------------
// Payload validation (allowlisted records only)
// ---------------------------------------------------------------------------

func s09ValidateLabel(value, ptr string) *runlearning.SafeError {
	if !s09ContentFreeLabel.MatchString(value) || s09PrivateValue(value) {
		return s09Err("policy_rejected", "private-content", ptr)
	}
	return nil
}

// s09ValidateForecast strict-decodes and value-checks an allowlisted
// runlearning.ForecastFeatureRecord, returning canonical bytes.
func s09ValidateForecast(raw json.RawMessage) ([]byte, *runlearning.SafeError) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	var f runlearning.ForecastFeatureRecord
	if err := dec.Decode(&f); err != nil {
		return nil, s09Err("invalid_payload", "payload-shape", "$/payload")
	}
	if f.SchemaVersion != runlearning.SchemaVersion {
		return nil, s09Err("invalid_payload", "schema-version", "$/payload/schemaVersion")
	}
	labels := []struct{ v, p string }{
		{f.FeatureSetVersion, "$/payload/featureSetVersion"},
		{f.TaskCohort, "$/payload/taskCohort"},
		{f.ConfigurationCohort, "$/payload/configurationCohort"},
		{f.SequentialWorkBucket, "$/payload/sequentialWorkBucket"},
		{f.CriticalPathBucket, "$/payload/criticalPathBucket"},
		{f.ReviewRetryAllowanceBucket, "$/payload/reviewRetryAllowanceBucket"},
		{f.ResourceClass, "$/payload/resourceClass"},
		{f.CostBucket, "$/payload/costBucket"},
		{f.DistributionStatus, "$/payload/distributionStatus"},
		{f.EstimatorRevision, "$/payload/estimatorRevision"},
		{f.RecordID, "$/payload/recordId"},
		{f.Provenance.Producer, "$/payload/provenance/producer"},
		{f.Provenance.DerivationRevision, "$/payload/provenance/derivationRevision"},
	}
	for _, l := range labels {
		if e := s09ValidateLabel(l.v, l.p); e != nil {
			return nil, e
		}
	}
	if f.SampleSize < 0 || f.Uncertainty < 0 || f.Uncertainty > 1 {
		return nil, s09Err("invalid_payload", "evidence-quality", "$/payload")
	}
	if f.UsefulLaneRange.Min < 0 || f.UsefulLaneRange.Max < f.UsefulLaneRange.Min {
		return nil, s09Err("invalid_payload", "evidence-quality", "$/payload/usefulLaneRange")
	}
	canonical, err := json.Marshal(f)
	if err != nil {
		return nil, s09Err("invalid_payload", "payload-shape", "$/payload")
	}
	return canonical, nil
}

// s09ValidateFact strict-decodes and value-checks a normalized
// incident/evaluation fact, returning canonical bytes.
func s09ValidateFact(raw json.RawMessage) ([]byte, *runlearning.SafeError) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	var f NormalizedFact
	if err := dec.Decode(&f); err != nil {
		return nil, s09Err("invalid_payload", "payload-shape", "$/payload")
	}
	if f.SchemaVersion != S09SchemaVersion {
		return nil, s09Err("invalid_payload", "schema-version", "$/payload/schemaVersion")
	}
	for _, l := range []struct{ v, p string }{
		{f.FactID, "$/payload/factId"},
		{f.Cohort, "$/payload/cohort"},
		{f.Signature, "$/payload/signature"},
	} {
		if e := s09ValidateLabel(l.v, l.p); e != nil {
			return nil, e
		}
	}
	if f.Count < 1 || f.SampleSize < 0 || f.Uncertainty < 0 || f.Uncertainty > 1 {
		return nil, s09Err("invalid_payload", "evidence-quality", "$/payload")
	}
	canonical, err := json.Marshal(f)
	if err != nil {
		return nil, s09Err("invalid_payload", "payload-shape", "$/payload")
	}
	return canonical, nil
}

// ---------------------------------------------------------------------------
// Intake store (append-only JSONL snapshot journal, S08 runlearning pattern)
// ---------------------------------------------------------------------------

type s09Snapshot struct {
	Candidates []S09Candidate  `json:"candidates"`
	Audit      []S09AuditEvent `json:"audit"`
}

// S09IntakeStore persists S09 candidates and their audit trail. It has no
// execution or publication authority: candidates are untrusted and never
// mutate canonical product state.
type S09IntakeStore struct {
	mu            sync.Mutex
	journal       *os.File
	candidates    map[string]*S09Candidate
	byIdempotency map[string]string
	audit         []S09AuditEvent
	nextSeq       int64
}

// NewS09IntakeStore returns an in-memory store (tests, ephemeral use).
func NewS09IntakeStore() *S09IntakeStore {
	return &S09IntakeStore{
		candidates:    map[string]*S09Candidate{},
		byIdempotency: map[string]string{},
		nextSeq:       1,
	}
}

// OpenS09IntakeStore rebuilds state from the append-only journal at path.
// Each successful mutation is synced before it returns.
func OpenS09IntakeStore(path string) (*S09IntakeStore, error) {
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
	s := NewS09IntakeStore()
	for _, line := range bytes.Split(complete, []byte{'\n'}) {
		if len(bytes.TrimSpace(line)) == 0 {
			continue
		}
		var snap s09Snapshot
		if err := json.Unmarshal(line, &snap); err != nil {
			return nil, fmt.Errorf("rebuild durable s09 intake state: %w", err)
		}
		s.restore(snap)
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

func (s *S09IntakeStore) restore(snap s09Snapshot) {
	for i := range snap.Candidates {
		c := snap.Candidates[i]
		s.candidates[c.ID] = &c
		s.byIdempotency[c.IdempotencyKey] = c.ID
	}
	s.audit = append(s.audit[:0], snap.Audit...)
	for _, e := range snap.Audit {
		if e.Seq >= s.nextSeq {
			s.nextSeq = e.Seq + 1
		}
	}
}

// Close closes the journal.
func (s *S09IntakeStore) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.journal == nil {
		return nil
	}
	err := s.journal.Close()
	s.journal = nil
	return err
}

func (s *S09IntakeStore) persistLocked() error {
	if s.journal == nil {
		return nil
	}
	snap := s09Snapshot{Audit: s.audit}
	for _, c := range s.candidates {
		snap.Candidates = append(snap.Candidates, *c)
	}
	sort.Slice(snap.Candidates, func(i, j int) bool { return snap.Candidates[i].ID < snap.Candidates[j].ID })
	b, err := json.Marshal(snap)
	if err != nil {
		return err
	}
	b = append(b, '\n')
	if _, err := s.journal.Write(b); err != nil {
		return err
	}
	return s.journal.Sync()
}

// Count returns the number of stored candidates (test/diagnostic aid).
func (s *S09IntakeStore) Count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.candidates)
}

// Get returns a candidate by ID, or nil.
func (s *S09IntakeStore) Get(id string) *S09Candidate {
	s.mu.Lock()
	defer s.mu.Unlock()
	c, ok := s.candidates[id]
	if !ok {
		return nil
	}
	clone := *c
	return &clone
}

// AuditTrail returns the ordered audit events for a candidate.
func (s *S09IntakeStore) AuditTrail(candidateID string) []S09AuditEvent {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []S09AuditEvent
	for _, e := range s.audit {
		if e.CandidateID == candidateID {
			out = append(out, e)
		}
	}
	return out
}

// Intake validates an untrusted request envelope and persists a quarantined
// candidate. Every rejection happens BEFORE persistence and leaves no state
// change; the raw ingress payload is never stored.
func (s *S09IntakeStore) Intake(raw []byte, now time.Time) S09IntakeResponse {
	resp := S09IntakeResponse{SchemaVersion: S09SchemaVersion}
	fail := func(e *runlearning.SafeError) S09IntakeResponse {
		resp.Error = e
		return resp
	}

	// 1. Size limit (413).
	if len(raw) > S09MaxIntakeBytes {
		return fail(s09Err("size_limit", "request-size", "$"))
	}
	// 2. Syntax-decode for the pre-persistence forbidden-field walk.
	var rawMap map[string]any
	if err := json.Unmarshal(raw, &rawMap); err != nil {
		return fail(s09Err("invalid_payload", "json-syntax", "$"))
	}
	// 3. Forbidden raw project/private fields rejected before persistence (422).
	if e := s09WalkRaw(rawMap, "$", S09PolicyRevision); e != nil {
		return fail(e)
	}
	// 4. Strict envelope decode (400 on unknown/malformed fields).
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	var req S09IntakeRequest
	if err := dec.Decode(&req); err != nil {
		return fail(s09Err("invalid_payload", "envelope-shape", "$"))
	}
	resp.RequestID = req.RequestID
	if req.SchemaVersion != S09SchemaVersion || req.RequestID == "" {
		return fail(s09Err("invalid_payload", "schema-version", "$/schemaVersion"))
	}
	// 5. Authenticated actor/workspace, hashed never raw (401).
	if !s09HashShape.MatchString(req.ActorIDHash) {
		return fail(s09Err("unauthenticated", "actor-identity", "$/actorIdHash"))
	}
	if !s09HashShape.MatchString(req.WorkspaceIDHash) {
		return fail(s09Err("unauthenticated", "workspace-identity", "$/workspaceIdHash"))
	}
	// 6. Explicit consent (403).
	if !s09ConsentShape.MatchString(req.ConsentID) {
		return fail(s09Err("consent_required", "consent", "$/consentId"))
	}
	// 7. Provenance (400).
	if req.Provenance.Producer == "" || req.Provenance.DerivationRevision == "" || req.Provenance.ObservedAt.IsZero() {
		return fail(s09Err("invalid_payload", "provenance", "$/provenance"))
	}
	// 8. Idempotency key (400).
	if !s09ConsentShape.MatchString(req.IdempotencyKey) {
		return fail(s09Err("invalid_payload", "idempotency", "$/idempotencyKey"))
	}
	// 9. Allowlisted source class + payload validation (400/422).
	var canonical []byte
	var e *runlearning.SafeError
	switch req.SourceClass {
	case S09SourceForecastFeature:
		canonical, e = s09ValidateForecast(req.Payload)
	case S09SourceIncidentFact, S09SourceEvaluationFact:
		canonical, e = s09ValidateFact(req.Payload)
	default:
		return fail(s09Err("invalid_payload", "source-class", "$/sourceClass"))
	}
	if e != nil {
		return fail(e)
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	// 10. Dedupe/replay (409 on conflicting reuse of the idempotency key).
	sum := sha256.Sum256(canonical)
	payloadHash := hex.EncodeToString(sum[:])
	if existingID, ok := s.byIdempotency[req.IdempotencyKey]; ok {
		existing := s.candidates[existingID]
		if existing.PayloadSha256 == payloadHash {
			resp.Result = existing
			return resp
		}
		return fail(s09Err("duplicate_or_conflict", "idempotency-conflict", "$/idempotencyKey"))
	}

	// 11. Persist quarantined (quarantine before review) + audit intake.
	idSum := sha256.Sum256([]byte("s09-candidate|" + req.IdempotencyKey + "|" + payloadHash))
	candidate := &S09Candidate{
		ID:              hex.EncodeToString(idSum[:])[:32],
		SchemaVersion:   S09SchemaVersion,
		IdempotencyKey:  req.IdempotencyKey,
		ConsentID:       req.ConsentID,
		ActorIDHash:     req.ActorIDHash,
		WorkspaceIDHash: req.WorkspaceIDHash,
		SourceClass:     req.SourceClass,
		Payload:         json.RawMessage(canonical),
		PayloadSha256:   payloadHash,
		Provenance:      req.Provenance,
		CreatedAt:       now.UTC(),
		Status:          S09StatusQuarantined,
	}
	s.candidates[candidate.ID] = candidate
	s.byIdempotency[req.IdempotencyKey] = candidate.ID
	s.audit = append(s.audit, S09AuditEvent{
		Seq: s.nextSeq, CandidateID: candidate.ID, Event: "intake",
		To: S09StatusQuarantined, ActorIDHash: req.ActorIDHash,
		Reason: "intake-quarantine", At: now.UTC(),
	})
	s.nextSeq++
	if err := s.persistLocked(); err != nil {
		delete(s.candidates, candidate.ID)
		delete(s.byIdempotency, req.IdempotencyKey)
		s.audit = s.audit[:len(s.audit)-1]
		s.nextSeq--
		return fail(s09Err("unavailable", "persistence", "$"))
	}
	resp.Result = candidate
	return resp
}

// Moderate applies a reversible, audited moderation transition.
func (s *S09IntakeStore) Moderate(id string, next S09CandidateStatus, actorIDHash, reason string, now time.Time) (*S09Candidate, *runlearning.SafeError) {
	if !s09HashShape.MatchString(actorIDHash) {
		return nil, s09Err("unauthenticated", "actor-identity", "$/actorIdHash")
	}
	if reason == "" || len(reason) > 256 || s09PrivateValue(reason) {
		return nil, s09Err("invalid_payload", "moderation-reason", "$/reason")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	c, ok := s.candidates[id]
	if !ok {
		return nil, s09Err("invalid_payload", "not-found", "$/id")
	}
	valid := false
	for _, st := range s09ModerationTransitions[c.Status] {
		if st == next {
			valid = true
			break
		}
	}
	if !valid {
		return nil, s09Err("invalid_payload", "transition", "$/status")
	}

	prev := c.Status
	c.Status = next
	s.audit = append(s.audit, S09AuditEvent{
		Seq: s.nextSeq, CandidateID: id, Event: "transition",
		From: prev, To: next, ActorIDHash: actorIDHash, Reason: reason, At: now.UTC(),
	})
	s.nextSeq++
	if err := s.persistLocked(); err != nil {
		c.Status = prev
		s.audit = s.audit[:len(s.audit)-1]
		s.nextSeq--
		return nil, s09Err("unavailable", "persistence", "$")
	}
	clone := *c
	return &clone, nil
}

// Delete tombstones a candidate (reversible via Moderate -> quarantined).
func (s *S09IntakeStore) Delete(id, actorIDHash, reason string, now time.Time) (*S09Candidate, *runlearning.SafeError) {
	return s.Moderate(id, S09StatusTombstoned, actorIDHash, reason, now)
}

// Export returns the exact normalized payload and current moderation state
// for user inspection. Export is audited and never mutates status; it fails
// closed on tombstoned (deleted) candidates.
func (s *S09IntakeStore) Export(id, actorIDHash string, now time.Time) (*S09ExportReceipt, *runlearning.SafeError) {
	if !s09HashShape.MatchString(actorIDHash) {
		return nil, s09Err("unauthenticated", "actor-identity", "$/actorIdHash")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	c, ok := s.candidates[id]
	if !ok {
		return nil, s09Err("invalid_payload", "not-found", "$/id")
	}
	if c.Status == S09StatusTombstoned {
		return nil, s09Err("policy_rejected", "candidate-removed", "$/id")
	}

	exportedAt := now.UTC()
	hashBytes, _ := json.Marshal(struct {
		CandidateID   string              `json:"candidateId"`
		PayloadSha256 string              `json:"payloadSha256"`
		Status        S09CandidateStatus  `json:"status"`
		ExportedAt    time.Time           `json:"exportedAt"`
	}{c.ID, c.PayloadSha256, c.Status, exportedAt})
	sum := sha256.Sum256(hashBytes)
	receipt := &S09ExportReceipt{
		ExportID:      fmt.Sprintf("s09exp-%s-%d", c.ID[:12], s.nextSeq),
		SchemaVersion: S09SchemaVersion,
		CandidateID:   c.ID,
		Status:        c.Status,
		SourceClass:   c.SourceClass,
		Payload:       c.Payload,
		PayloadSha256: c.PayloadSha256,
		ReceiptHash:   hex.EncodeToString(sum[:]),
		ExportedAt:    exportedAt,
	}
	s.audit = append(s.audit, S09AuditEvent{
		Seq: s.nextSeq, CandidateID: id, Event: "export",
		ActorIDHash: actorIDHash, Reason: "export-receipt", At: exportedAt,
	})
	s.nextSeq++
	if err := s.persistLocked(); err != nil {
		s.audit = s.audit[:len(s.audit)-1]
		s.nextSeq--
		return nil, s09Err("unavailable", "persistence", "$")
	}
	return receipt, nil
}
