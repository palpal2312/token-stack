package memory

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	SchemaVersion   = "1.0.0"
	PolicyRevision  = "s08-memory-policy-1"
	DerivationRev   = "s08-context-pack-1"
	MigrationID     = "s08b_001" // lane-local fragment marker; registration is integration-owned
	DefaultMaxBytes = 256 * 1024
	DefaultMaxItems = 256
)

type Kind string

const (
	Working    Kind = "working"
	Episodic   Kind = "episodic"
	Semantic   Kind = "semantic"
	Procedural Kind = "procedural"
)

type State string

const (
	Active      State = "active"
	Quarantined State = "quarantined"
	Superseded  State = "superseded"
	Deleted     State = "deleted"
)

type Provenance struct {
	SourceID    string    `json:"sourceId"`
	SourceURI   string    `json:"sourceUri"`
	ObservedAt  time.Time `json:"observedAt"`
	ContentHash string    `json:"contentHash"`
}

type ACL struct {
	Readers []string `json:"readers"`
}

func (a ACL) Allows(principal string) bool {
	for _, reader := range a.Readers {
		if reader == principal { return true }
	}
	return false
}

type Record struct {
	ID            string     `json:"id"`
	Kind          Kind       `json:"kind"`
	State         State      `json:"state"`
	Content       string     `json:"content"`
	ACL           ACL        `json:"acl"`
	Provenance    Provenance `json:"provenance"`
	CreatedAt     time.Time  `json:"createdAt"`
	Supersedes    string     `json:"supersedes,omitempty"`
	StaleSource   bool       `json:"staleSource"`
	RedactionTags []string   `json:"redactionTags,omitempty"`
}

type AuditEvent struct {
	Action    string    `json:"action"`
	RecordID  string    `json:"recordId"`
	RelatedID string    `json:"relatedId,omitempty"`
	At        time.Time `json:"at"`
}

type SafeError struct {
	SchemaVersion  string `json:"schemaVersion"`
	ErrorCode      string `json:"errorCode"`
	RuleClass      string `json:"ruleClass"`
	FieldPointer   string `json:"fieldPointer"`
	Retryable      bool   `json:"retryable"`
	PolicyRevision string `json:"policyRevision"`
	CorrelationID  string `json:"correlationId"`
}

func (e *SafeError) Error() string { return e.ErrorCode + " at " + e.FieldPointer }

func safeError(code, class, pointer string) error {
	sum := sha256.Sum256([]byte(code + "\x00" + class + "\x00" + pointer))
	return &SafeError{SchemaVersion: SchemaVersion, ErrorCode: code, RuleClass: class, FieldPointer: pointer, PolicyRevision: PolicyRevision, CorrelationID: hex.EncodeToString(sum[:8])}
}

type ParserCaps struct { MaxBytes, MaxItems int }

type IngestRequest struct {
	Kind       Kind
	Content    string
	ACL        ACL
	SourceID   string
	SourceURI  string
	ObservedAt time.Time
	ItemCount  int
}

var secretPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)(api[_-]?key|password|token|secret|authorization)\s*[:=]\s*[^\s,;]+`),
	regexp.MustCompile(`(?i)bearer\s+[a-z0-9._~+/=-]+`),
	regexp.MustCompile(`-----BEGIN [A-Z ]*PRIVATE KEY-----`),
}

func redactSecrets(value string) (string, []string) {
	tags := []string{}
	for _, pattern := range secretPatterns {
		if pattern.MatchString(value) {
			value = pattern.ReplaceAllString(value, "[redacted]")
			tags = append(tags, "secret")
		}
	}
	if len(tags) > 1 { tags = tags[:1] }
	return value, tags
}

type Store struct {
	mu      sync.RWMutex
	records map[string]Record
	audit   []AuditEvent
	index   map[string]map[string]struct{}
}

func NewStore() *Store { return &Store{records: map[string]Record{}, index: map[string]map[string]struct{}{}} }

func validKind(kind Kind) bool { return kind == Working || kind == Episodic || kind == Semantic || kind == Procedural }

func (s *Store) Ingest(req IngestRequest, caps ParserCaps) (Record, error) {
	if caps.MaxBytes == 0 { caps.MaxBytes = DefaultMaxBytes }
	if caps.MaxItems == 0 { caps.MaxItems = DefaultMaxItems }
	if len(req.Content) > caps.MaxBytes { return Record{}, safeError("PARSER_CAP_EXCEEDED", "parser-bytes", "/content") }
	if req.ItemCount < 0 || req.ItemCount > caps.MaxItems { return Record{}, safeError("PARSER_CAP_EXCEEDED", "parser-items", "/itemCount") }
	if !validKind(req.Kind) { return Record{}, safeError("MEMORY_KIND_INVALID", "memory-boundary", "/kind") }
	if len(req.ACL.Readers) == 0 { return Record{}, safeError("ACL_REQUIRED", "access-control", "/acl/readers") }
	clean, tags := redactSecrets(req.Content)
	contentHash := hashString(clean)
	id := hashString(string(req.Kind) + "\x00" + req.SourceID + "\x00" + contentHash)[:24]
	record := Record{ID: id, Kind: req.Kind, State: Active, Content: clean, ACL: req.ACL, Provenance: Provenance{SourceID: req.SourceID, SourceURI: req.SourceURI, ObservedAt: req.ObservedAt.UTC(), ContentHash: contentHash}, CreatedAt: req.ObservedAt.UTC(), RedactionTags: tags}
	if req.SourceID == "" || req.ObservedAt.IsZero() {
		record.State = Quarantined
	}
	s.mu.Lock(); defer s.mu.Unlock()
	if existing, ok := s.records[id]; ok { return existing, nil }
	s.records[id] = record
	s.audit = append(s.audit, AuditEvent{Action: "ingest_" + string(record.State), RecordID: id, At: req.ObservedAt.UTC()})
	if record.State == Active { s.addIndex(record) }
	return record, nil
}

func (s *Store) Correct(id, replacement string, at time.Time) (Record, error) {
	s.mu.Lock(); defer s.mu.Unlock()
	old, ok := s.records[id]
	if !ok || old.State == Deleted { return Record{}, safeError("NOT_FOUND", "record-state", "/recordId") }
	clean, tags := redactSecrets(replacement)
	newID := hashString(string(old.Kind) + "\x00" + old.Provenance.SourceID + "\x00" + hashString(clean))[:24]
	if existing, ok := s.records[newID]; ok { return existing, nil }
	s.removeIndex(old)
	old.State = Superseded; s.records[id] = old
	next := old; next.ID = newID; next.State = Active; next.Content = clean; next.CreatedAt = at.UTC(); next.Supersedes = id; next.Provenance.ContentHash = hashString(clean); next.RedactionTags = tags
	s.records[newID] = next; s.addIndex(next)
	s.audit = append(s.audit, AuditEvent{Action: "correct", RecordID: newID, RelatedID: id, At: at.UTC()})
	return next, nil
}

func (s *Store) Delete(id string, at time.Time) error {
	s.mu.Lock(); defer s.mu.Unlock()
	record, ok := s.records[id]
	if !ok { return nil }
	if record.State == Deleted { return nil }
	s.removeIndex(record); record.State = Deleted; record.Content = ""; s.records[id] = record
	s.audit = append(s.audit, AuditEvent{Action: "delete", RecordID: id, At: at.UTC()})
	return nil
}

func (s *Store) MarkSourceStale(sourceID string, at time.Time) int {
	s.mu.Lock(); defer s.mu.Unlock()
	count := 0
	for id, record := range s.records {
		if record.Provenance.SourceID == sourceID && record.State == Active && !record.StaleSource {
			record.StaleSource = true; s.records[id] = record; count++
			s.audit = append(s.audit, AuditEvent{Action: "source_stale", RecordID: id, At: at.UTC()})
		}
	}
	return count
}

func (s *Store) Export(principal string) []Record {
	s.mu.RLock(); defer s.mu.RUnlock()
	result := []Record{}
	for _, record := range s.records {
		if record.State == Active && record.ACL.Allows(principal) { result = append(result, record) }
	}
	sort.Slice(result, func(i,j int) bool { return result[i].ID < result[j].ID })
	return result
}

type SearchOptions struct { ForceFTSFallback bool; Limit int }

type SearchResult struct { Record Record; Score int }

func (s *Store) Search(principal, query string, opts SearchOptions) []SearchResult {
	s.mu.RLock(); defer s.mu.RUnlock()
	if opts.Limit <= 0 { opts.Limit = 20 }
	terms := tokenize(query); candidates := map[string]struct{}{}
	if !opts.ForceFTSFallback {
		for _, term := range terms { for id := range s.index[term] { candidates[id] = struct{}{} } }
	} else {
		for id := range s.records { candidates[id] = struct{}{} }
	}
	results := []SearchResult{}
	for id := range candidates {
		record := s.records[id]
		// Authorization and lifecycle checks deliberately precede scoring/ranking.
		if !record.ACL.Allows(principal) || record.State != Active { continue }
		score := 0; content := strings.ToLower(record.Content)
		for _, term := range terms { score += strings.Count(content, term) }
		if score > 0 { results = append(results, SearchResult{Record: record, Score: score}) }
	}
	sort.Slice(results, func(i,j int) bool { if results[i].Score != results[j].Score { return results[i].Score > results[j].Score }; return results[i].Record.ID < results[j].Record.ID })
	if len(results) > opts.Limit { results = results[:opts.Limit] }
	return results
}

func (s *Store) RebuildProjection() {
	s.mu.Lock(); defer s.mu.Unlock(); s.index = map[string]map[string]struct{}{}
	for _, record := range s.records { if record.State == Active { s.addIndex(record) } }
}

func (s *Store) Audit() []AuditEvent { s.mu.RLock(); defer s.mu.RUnlock(); return append([]AuditEvent(nil), s.audit...) }

func (s *Store) addIndex(record Record) { for _, term := range tokenize(record.Content) { if s.index[term] == nil { s.index[term] = map[string]struct{}{} }; s.index[term][record.ID] = struct{}{} } }
func (s *Store) removeIndex(record Record) { for _, term := range tokenize(record.Content) { delete(s.index[term], record.ID) } }
func tokenize(value string) []string { fields := strings.FieldsFunc(strings.ToLower(value), func(r rune) bool { return !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9') }); seen := map[string]bool{}; out := []string{}; for _, f := range fields { if f != "" && !seen[f] { seen[f]=true; out=append(out,f) } }; return out }
func hashString(value string) string { sum := sha256.Sum256([]byte(value)); return hex.EncodeToString(sum[:]) }

type Citation struct {
	Ordinal     int    `json:"ordinal"`
	RecordID    string `json:"recordId"`
	ContentHash string `json:"contentHash"`
	SourceID    string `json:"sourceId"`
}

type ContextItem struct { Citation int `json:"citation"`; Kind Kind `json:"kind"`; Content string `json:"content"`; StaleSource bool `json:"staleSource"` }
type ContextPack struct {
	SchemaVersion string        `json:"schemaVersion"`
	PackHash      string        `json:"packHash"`
	QueryHash     string        `json:"queryHash"`
	Items         []ContextItem `json:"items"`
	Citations     []Citation    `json:"citations"`
}

func (s *Store) BuildContextPack(principal, query string, limit int) (ContextPack, error) {
	if principal == "" { return ContextPack{}, safeError("ACL_REQUIRED", "access-control", "/principal") }
	results := s.Search(principal, query, SearchOptions{Limit: limit})
	pack := ContextPack{SchemaVersion: SchemaVersion, QueryHash: hashString(query), Items: []ContextItem{}, Citations: []Citation{}}
	for index, result := range results {
		ordinal := index + 1
		pack.Citations = append(pack.Citations, Citation{Ordinal: ordinal, RecordID: result.Record.ID, ContentHash: result.Record.Provenance.ContentHash, SourceID: result.Record.Provenance.SourceID})
		pack.Items = append(pack.Items, ContextItem{Citation: ordinal, Kind: result.Record.Kind, Content: result.Record.Content, StaleSource: result.Record.StaleSource})
	}
	payload, err := json.Marshal(struct { SchemaVersion string `json:"schemaVersion"`; QueryHash string `json:"queryHash"`; Items []ContextItem `json:"items"`; Citations []Citation `json:"citations"` }{pack.SchemaVersion, pack.QueryHash, pack.Items, pack.Citations})
	if err != nil { return ContextPack{}, fmt.Errorf("canonical context pack: %w", err) }
	pack.PackHash = hashString(string(payload))
	return pack, nil
}

func ValidatePack(pack ContextPack) error {
	if len(pack.Items) != len(pack.Citations) { return errors.New("citation count mismatch") }
	for i := range pack.Items { if pack.Items[i].Citation != i+1 || pack.Citations[i].Ordinal != i+1 { return errors.New("citation order invalid") }; if pack.Citations[i].ContentHash != hashString(pack.Items[i].Content) { return errors.New("citation content hash invalid") } }
	return nil
}
