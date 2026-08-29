package community

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"agentic-os/internal/runlearning"
)

var (
	s09TestActorHash     = s09TestHash("actor")
	s09TestWorkspaceHash = s09TestHash("workspace")
	s09TestNow           = time.Date(2026, 8, 28, 12, 0, 0, 0, time.UTC)
)

func s09TestHash(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

// s09ForecastPayload returns a valid allowlisted ForecastFeatureRecord payload.
func s09ForecastPayload() json.RawMessage {
	f := runlearning.ForecastFeatureRecord{
		Envelope: runlearning.Envelope{
			SchemaVersion:  runlearning.SchemaVersion,
			RecordID:       "0123456789abcdef0123456789abcdef",
			IdempotencyKey: strings.Repeat("ab", 32),
			CreatedAt:      s09TestNow,
			Provenance: runlearning.Provenance{
				Producer:           "runlearning",
				SourceRecordIDs:    []string{"feedface0123456789abcdef0123456789"},
				DerivationRevision: "s08c-1",
				ObservedAt:         s09TestNow,
			},
			RedactionClass: "content-free",
			PolicyRevision: "s08c-1",
		},
		RunLearningRecordID:        "feedface0123456789abcdef0123456789",
		FeatureSetVersion:          "fs-1",
		TaskCohort:                 "small-task",
		ConfigurationCohort:        "cfg-a",
		SequentialWorkBucket:       "lt-1m",
		CriticalPathBucket:         "1m-5m",
		UsefulLaneRange:            runlearning.UsefulLaneRange{Min: 1, Max: 2},
		ReviewRetryAllowanceBucket: "1-2",
		ResourceClass:              "cpu-small",
		CostBucket:                 "low",
		SampleSize:                 12,
		Uncertainty:                0.25,
		DistributionStatus:         "complete",
		EstimatorRevision:          "est-1",
	}
	b, err := json.Marshal(f)
	if err != nil {
		panic(err)
	}
	return b
}

// s09FactPayload returns a valid normalized incident/evaluation fact payload.
func s09FactPayload() json.RawMessage {
	return json.RawMessage(`{
		"schemaVersion": "1.0.0",
		"factId": "fact-001",
		"cohort": "small-task",
		"signature": "est-overrun-2x",
		"count": 3,
		"sampleSize": 12,
		"uncertainty": 0.25
	}`)
}

type s09RequestOpts struct {
	consentID       string
	actorIDHash     string
	workspaceIDHash string
	idempotencyKey  string
	sourceClass     string
	payload         json.RawMessage
}

func s09BuildRequest(t *testing.T, o s09RequestOpts) []byte {
	t.Helper()
	if o.consentID == "" {
		o.consentID = "consent-001"
	}
	if o.actorIDHash == "" {
		o.actorIDHash = s09TestActorHash
	}
	if o.workspaceIDHash == "" {
		o.workspaceIDHash = s09TestWorkspaceHash
	}
	if o.idempotencyKey == "" {
		o.idempotencyKey = "idem-001"
	}
	if o.sourceClass == "" {
		o.sourceClass = S09SourceForecastFeature
	}
	if o.payload == nil {
		o.payload = s09ForecastPayload()
	}
	req := S09IntakeRequest{
		SchemaVersion:   S09SchemaVersion,
		RequestID:       "req-001",
		IdempotencyKey:  o.idempotencyKey,
		ConsentID:       o.consentID,
		ActorIDHash:     o.actorIDHash,
		WorkspaceIDHash: o.workspaceIDHash,
		SourceClass:     o.sourceClass,
		Provenance: runlearning.Provenance{
			Producer:           "runlearning",
			SourceRecordIDs:    []string{"feedface0123456789abcdef0123456789"},
			DerivationRevision: "s08c-1",
			ObservedAt:         s09TestNow,
		},
		Payload: o.payload,
	}
	b, err := json.Marshal(req)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	return b
}

func s09MustIntake(t *testing.T, s *S09IntakeStore, raw []byte) *S09Candidate {
	t.Helper()
	resp := s.Intake(raw, s09TestNow)
	if resp.Error != nil {
		t.Fatalf("intake failed: %s at %s", resp.Error.ErrorCode, resp.Error.FieldPointer)
	}
	if resp.Result == nil {
		t.Fatal("intake returned no candidate")
	}
	return resp.Result
}

// Gate: consent + quarantine. Intake requires explicit consent and an
// authenticated (hashed) actor/workspace; candidates land in quarantine
// before any review and cannot skip review straight to accepted.
func TestS09Intake_ConsentRequiredAndQuarantineFirst(t *testing.T) {
	s := NewS09IntakeStore()

	// Missing consent -> 403 consent_required, no state change.
	resp := s.Intake(s09BuildRequest(t, s09RequestOpts{consentID: " "}), s09TestNow)
	if resp.Error == nil || resp.Error.ErrorCode != "consent_required" {
		t.Fatalf("expected consent_required, got %+v", resp.Error)
	}
	if s.Count() != 0 {
		t.Fatal("rejected intake must not persist state")
	}

	// Raw (unhashed) actor identifier -> 401 unauthenticated.
	resp = s.Intake(s09BuildRequest(t, s09RequestOpts{actorIDHash: "user-raw-42"}), s09TestNow)
	if resp.Error == nil || resp.Error.ErrorCode != "unauthenticated" {
		t.Fatalf("expected unauthenticated, got %+v", resp.Error)
	}
	resp = s.Intake(s09BuildRequest(t, s09RequestOpts{workspaceIDHash: "ws-raw"}), s09TestNow)
	if resp.Error == nil || resp.Error.ErrorCode != "unauthenticated" {
		t.Fatalf("expected unauthenticated, got %+v", resp.Error)
	}

	// Valid intake lands in quarantine, never directly reviewable-accepted.
	c := s09MustIntake(t, s, s09BuildRequest(t, s09RequestOpts{}))
	if c.Status != S09StatusQuarantined {
		t.Fatalf("expected quarantine-first, got %q", c.Status)
	}
	if _, e := s.Moderate(c.ID, S09StatusAccepted, s09TestActorHash, "skip-review", s09TestNow); e == nil {
		t.Fatal("quarantined -> accepted must be rejected (review required first)")
	}
	if _, e := s.Moderate(c.ID, S09StatusUnderReview, s09TestActorHash, "begin-review", s09TestNow); e != nil {
		t.Fatalf("quarantined -> under_review failed: %v", e)
	}

	// Missing provenance -> invalid_payload, no state change.
	raw := s09BuildRequest(t, s09RequestOpts{idempotencyKey: "idem-noprov"})
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	delete(m, "provenance")
	rawNoProv, _ := json.Marshal(m)
	resp = s.Intake(rawNoProv, s09TestNow)
	if resp.Error == nil || resp.Error.ErrorCode != "invalid_payload" {
		t.Fatalf("expected invalid_payload for missing provenance, got %+v", resp.Error)
	}
}

// Gate: forbidden-field negatives. Every contract forbidden class, nested at
// any depth in payload or envelope, is rejected before persistence.
func TestS09Intake_ForbiddenFieldNegatives(t *testing.T) {
	forbiddenKeys := []string{
		"prompt", "conversation", "user_story", "userStory", "source", "sourceCode",
		"diff", "repository", "path", "filePath", "raw_log", "rawLog", "secret",
		"token", "credential", "credentials", "personal_data", "personalData",
		"exact_private_identifier", "exactPrivateIdentifier",
	}
	for _, key := range forbiddenKeys {
		t.Run("payload/"+key, func(t *testing.T) {
			s := NewS09IntakeStore()
			payload := json.RawMessage(fmt.Sprintf(`{
				"schemaVersion": "1.0.0", "factId": "fact-x", "cohort": "c",
				"signature": "sig", "count": 1, "sampleSize": 1, "uncertainty": 0.1,
				"nested": {"deep": {%q: "raw private content"}}
			}`, key))
			resp := s.Intake(s09BuildRequest(t, s09RequestOpts{
				sourceClass: S09SourceIncidentFact, payload: payload,
			}), s09TestNow)
			if resp.Error == nil || resp.Error.ErrorCode != "policy_rejected" {
				t.Fatalf("key %q: expected policy_rejected, got %+v", key, resp.Error)
			}
			if s.Count() != 0 {
				t.Fatalf("key %q: forbidden intake persisted state", key)
			}
		})
		t.Run("envelope/"+key, func(t *testing.T) {
			s := NewS09IntakeStore()
			raw := s09BuildRequest(t, s09RequestOpts{})
			var m map[string]any
			if err := json.Unmarshal(raw, &m); err != nil {
				t.Fatal(err)
			}
			m[key] = "raw private content"
			rawForbidden, _ := json.Marshal(m)
			resp := s.Intake(rawForbidden, s09TestNow)
			if resp.Error == nil || resp.Error.ErrorCode != "policy_rejected" {
				t.Fatalf("key %q: expected policy_rejected, got %+v", key, resp.Error)
			}
			if s.Count() != 0 {
				t.Fatalf("key %q: forbidden intake persisted state", key)
			}
		})
	}

	// Secret-shaped values are rejected even under innocuous keys.
	for _, v := range []string{
		"Bearer abcdef123456", "-----BEGIN RSA PRIVATE KEY-----",
		"api_key: xyz", "eyJhbGci.eyJzdWIi.signature",
	} {
		s := NewS09IntakeStore()
		payload := json.RawMessage(fmt.Sprintf(`{
			"schemaVersion": "1.0.0", "factId": "fact-y", "cohort": %q,
			"signature": "sig", "count": 1, "sampleSize": 1, "uncertainty": 0.1
		}`, v))
		resp := s.Intake(s09BuildRequest(t, s09RequestOpts{
			sourceClass: S09SourceIncidentFact, payload: payload,
		}), s09TestNow)
		if resp.Error == nil || resp.Error.ErrorCode != "policy_rejected" {
			t.Fatalf("value %q: expected policy_rejected, got %+v", v, resp.Error)
		}
	}

	// Contract-sanctioned carriers (sourceClass, provenance.sourceRecordIds)
	// must NOT trip the walker: a valid request still succeeds.
	s := NewS09IntakeStore()
	s09MustIntake(t, s, s09BuildRequest(t, s09RequestOpts{}))

	// Non-allowlisted source class is rejected.
	resp := s.Intake(s09BuildRequest(t, s09RequestOpts{
		idempotencyKey: "idem-raw", sourceClass: "raw_project_dump",
	}), s09TestNow)
	if resp.Error == nil || resp.Error.ErrorCode != "invalid_payload" {
		t.Fatalf("expected invalid_payload for raw source class, got %+v", resp.Error)
	}
}

// Gate: dedupe/replay. Exact replay returns the original record; conflicting
// reuse of the idempotency key fails closed; replay survives journal rebuild.
func TestS09Intake_DedupeReplayAndCrashRebuild(t *testing.T) {
	journal := filepath.Join(t.TempDir(), "s09-intake.journal")
	raw := s09BuildRequest(t, s09RequestOpts{})

	s, err := OpenS09IntakeStore(journal)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	first := s09MustIntake(t, s, raw)

	// Exact replay: same record, no duplicate, no extra audit event.
	replay := s09MustIntake(t, s, raw)
	if replay.ID != first.ID {
		t.Fatalf("replay returned different id %q vs %q", replay.ID, first.ID)
	}
	if s.Count() != 1 {
		t.Fatalf("replay created duplicate, count=%d", s.Count())
	}
	if n := len(s.AuditTrail(first.ID)); n != 1 {
		t.Fatalf("replay appended audit events, trail=%d", n)
	}

	// Same key, different payload -> 409 duplicate_or_conflict.
	conflict := s.Intake(s09BuildRequest(t, s09RequestOpts{payload: s09FactPayload(), sourceClass: S09SourceIncidentFact}), s09TestNow)
	if conflict.Error == nil || conflict.Error.ErrorCode != "duplicate_or_conflict" {
		t.Fatalf("expected duplicate_or_conflict, got %+v", conflict.Error)
	}
	if s.Count() != 1 {
		t.Fatal("conflicting replay must not persist state")
	}
	if err := s.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	// Crash rebuild: state restored, dedupe still enforced from the journal.
	reopened, err := OpenS09IntakeStore(journal)
	if err != nil {
		t.Fatalf("reopen store: %v", err)
	}
	t.Cleanup(func() { reopened.Close() })
	if reopened.Count() != 1 {
		t.Fatalf("rebuild lost candidate, count=%d", reopened.Count())
	}
	restored := reopened.Get(first.ID)
	if restored == nil || restored.PayloadSha256 != first.PayloadSha256 || restored.Status != first.Status {
		t.Fatal("rebuilt candidate diverges from original")
	}
	again := s09MustIntake(t, reopened, raw)
	if again.ID != first.ID {
		t.Fatal("post-rebuild replay returned different record")
	}
	if n := len(reopened.AuditTrail(first.ID)); n != 1 {
		t.Fatalf("post-rebuild replay duplicated audit, trail=%d", n)
	}
}

// Gate: reversible reject/delete/export with a complete audit trail.
func TestS09Intake_ReversibleModerationRejectDeleteExport(t *testing.T) {
	s := NewS09IntakeStore()
	c := s09MustIntake(t, s, s09BuildRequest(t, s09RequestOpts{}))
	at := func(i int) time.Time { return s09TestNow.Add(time.Duration(i) * time.Minute) }

	mustModerate := func(next S09CandidateStatus, reason string, i int) {
		t.Helper()
		got, e := s.Moderate(c.ID, next, s09TestActorHash, reason, at(i))
		if e != nil {
			t.Fatalf("moderate -> %s failed: %s at %s", next, e.ErrorCode, e.FieldPointer)
		}
		if got.Status != next {
			t.Fatalf("expected status %q, got %q", next, got.Status)
		}
	}

	// quarantined -> under_review -> accepted -> rejected -> quarantined (reverse reject).
	mustModerate(S09StatusUnderReview, "begin-review", 1)
	mustModerate(S09StatusAccepted, "evidence-valid", 2)
	mustModerate(S09StatusRejected, "policy-change", 3)
	mustModerate(S09StatusQuarantined, "reject-reversed", 4)

	// Export: exact normalized payload, hash match, no state mutation.
	receipt, e := s.Export(c.ID, s09TestActorHash, at(5))
	if e != nil {
		t.Fatalf("export failed: %s", e.ErrorCode)
	}
	if receipt.PayloadSha256 != c.PayloadSha256 {
		t.Fatal("export payload hash mismatch")
	}
	sum := sha256.Sum256(receipt.Payload)
	if hex.EncodeToString(sum[:]) != c.PayloadSha256 {
		t.Fatal("export payload bytes do not hash to stored payloadSha256")
	}
	if got := s.Get(c.ID); got.Status != S09StatusQuarantined {
		t.Fatalf("export mutated status to %q", got.Status)
	}
	// Exported payload is strictly the allowlisted normalized record.
	var exported map[string]any
	if err := json.Unmarshal(receipt.Payload, &exported); err != nil {
		t.Fatal(err)
	}
	allowed := map[string]bool{
		"schemaVersion": true, "recordId": true, "idempotencyKey": true, "createdAt": true,
		"provenance": true, "redactionClass": true, "policyRevision": true,
		"runLearningRecordId": true, "featureSetVersion": true, "taskCohort": true,
		"configurationCohort": true, "sequentialWorkBucket": true, "criticalPathBucket": true,
		"usefulLaneRange": true, "reviewRetryAllowanceBucket": true, "resourceClass": true,
		"costBucket": true, "sampleSize": true, "uncertainty": true,
		"distributionStatus": true, "estimatorRevision": true,
	}
	for k := range exported {
		if !allowed[k] {
			t.Fatalf("exported payload carries non-allowlisted field %q", k)
		}
	}

	// Delete -> tombstoned; export fails closed; restore reverses the delete.
	if _, e := s.Delete(c.ID, s09TestActorHash, "user-withdrawal", at(6)); e != nil {
		t.Fatalf("delete failed: %s", e.ErrorCode)
	}
	if got := s.Get(c.ID); got.Status != S09StatusTombstoned {
		t.Fatalf("expected tombstoned, got %q", got.Status)
	}
	if _, e := s.Export(c.ID, s09TestActorHash, at(7)); e == nil || e.ErrorCode != "policy_rejected" {
		t.Fatalf("expected policy_rejected exporting tombstoned, got %+v", e)
	}
	mustModerate(S09StatusQuarantined, "delete-reversed", 8)

	// Audit trail: every transition recorded in order with actor and reason.
	trail := s.AuditTrail(c.ID)
	wantEvents := []struct{ event, to, reason string }{
		{"intake", "quarantined", "intake-quarantine"},
		{"transition", "under_review", "begin-review"},
		{"transition", "accepted", "evidence-valid"},
		{"transition", "rejected", "policy-change"},
		{"transition", "quarantined", "reject-reversed"},
		{"export", "", "export-receipt"},
		{"transition", "tombstoned", "user-withdrawal"},
		{"transition", "quarantined", "delete-reversed"},
	}
	if len(trail) != len(wantEvents) {
		t.Fatalf("audit trail length %d, want %d", len(trail), len(wantEvents))
	}
	for i, w := range wantEvents {
		if trail[i].Event != w.event || trail[i].Reason != w.reason {
			t.Fatalf("audit[%d] = %s/%s, want %s/%s", i, trail[i].Event, trail[i].Reason, w.event, w.reason)
		}
		if w.to != "" && string(trail[i].To) != w.to {
			t.Fatalf("audit[%d].To = %q, want %q", i, trail[i].To, w.to)
		}
		if trail[i].ActorIDHash != s09TestActorHash {
			t.Fatalf("audit[%d] missing actor hash", i)
		}
	}
}

// Normalized incident/evaluation facts intake; content-free validation and
// size limits fail closed.
func TestS09Intake_NormalizedFactsAndSizeLimit(t *testing.T) {
	s := NewS09IntakeStore()

	incident := s09MustIntake(t, s, s09BuildRequest(t, s09RequestOpts{
		idempotencyKey: "idem-incident", sourceClass: S09SourceIncidentFact, payload: s09FactPayload(),
	}))
	if incident.SourceClass != S09SourceIncidentFact || incident.Status != S09StatusQuarantined {
		t.Fatalf("incident fact intake wrong: %s/%s", incident.SourceClass, incident.Status)
	}
	evaluation := s09MustIntake(t, s, s09BuildRequest(t, s09RequestOpts{
		idempotencyKey: "idem-eval", sourceClass: S09SourceEvaluationFact, payload: s09FactPayload(),
	}))
	if evaluation.SourceClass != S09SourceEvaluationFact {
		t.Fatal("evaluation fact source class not preserved")
	}

	// Poisoned fact: signature smuggling a path/private shape -> policy_rejected.
	badFact := json.RawMessage(`{
		"schemaVersion": "1.0.0", "factId": "fact-z", "cohort": "c",
		"signature": "C:\\Users\\victim\\repo", "count": 1, "sampleSize": 1, "uncertainty": 0.1
	}`)
	resp := s.Intake(s09BuildRequest(t, s09RequestOpts{
		idempotencyKey: "idem-badfact", sourceClass: S09SourceIncidentFact, payload: badFact,
	}), s09TestNow)
	if resp.Error == nil || resp.Error.ErrorCode != "policy_rejected" {
		t.Fatalf("expected policy_rejected for poisoned signature, got %+v", resp.Error)
	}

	// Oversized request -> 413 size_limit.
	big := make([]byte, S09MaxIntakeBytes+1)
	copy(big, s09BuildRequest(t, s09RequestOpts{idempotencyKey: "idem-big"}))
	resp = s.Intake(big, s09TestNow)
	if resp.Error == nil || resp.Error.ErrorCode != "size_limit" {
		t.Fatalf("expected size_limit, got %+v", resp.Error)
	}
}

// Stored payload must never contain raw ingress bytes beyond the strict
// allowlisted record (no RawPayload promotion from the S08 quarantine lane).
func TestS09Intake_NoRawPayloadPromotion(t *testing.T) {
	s := NewS09IntakeStore()
	c := s09MustIntake(t, s, s09BuildRequest(t, s09RequestOpts{}))

	var stored map[string]any
	if err := json.Unmarshal(c.Payload, &stored); err != nil {
		t.Fatalf("stored payload not canonical JSON: %v", err)
	}
	if _, ok := stored["raw_payload"]; ok {
		t.Fatal("raw payload field promoted into S09 candidate")
	}
	if _, ok := stored["rawPayload"]; ok {
		t.Fatal("raw payload field promoted into S09 candidate")
	}
	// Re-marshaled canonical bytes equal stored bytes (strict normalization).
	var typed runlearning.ForecastFeatureRecord
	if err := json.Unmarshal(c.Payload, &typed); err != nil {
		t.Fatal(err)
	}
	canonical, _ := json.Marshal(typed)
	if string(canonical) != string(c.Payload) {
		t.Fatal("stored payload is not the strict canonical record")
	}
}
