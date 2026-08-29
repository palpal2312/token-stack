package community

import (
	"crypto/ed25519"
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	"agentic-os/internal/runlearning"
)

const s09SnapTestKeyID = "s09-test-key-1"

func s09SnapTestKeys(t *testing.T) (S09KeyRegistry, ed25519.PrivateKey) {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(nil) // in-memory only; never written to repo
	if err != nil {
		t.Fatalf("generate ed25519 key: %v", err)
	}
	return S09KeyRegistry{s09SnapTestKeyID: pub}, priv
}

func s09SnapFacts() json.RawMessage {
	return json.RawMessage(`[
		{
			"schemaVersion": "1.0.0",
			"factId": "fact-001",
			"cohort": "small-task",
			"signature": "est-overrun-2x",
			"count": 3,
			"sampleSize": 12,
			"uncertainty": 0.25
		}
	]`)
}

func s09SnapProvenance(now time.Time) runlearning.Provenance {
	return runlearning.Provenance{
		Producer:           "community-aggregator",
		SourceRecordIDs:    []string{"feedface0123456789abcdef0123456789"},
		DerivationRevision: "s09-1",
		ObservedAt:         now,
	}
}

func s09BuildSignedSnapshot(t *testing.T, priv ed25519.PrivateKey, version, rollback int64, now time.Time) CommunityKnowledgeSnapshot {
	t.Helper()
	snap := CommunityKnowledgeSnapshot{
		SnapshotID:      "snap-001",
		SchemaVersion:   S09SchemaVersion,
		SnapshotVersion: version,
		Cohort:          "small-task",
		Facts:           s09SnapFacts(),
		SampleSize:      12,
		Uncertainty:     0.25,
		ValidFrom:       now.Add(-time.Hour),
		ExpiresAt:       now.Add(24 * time.Hour),
		KeyID:           s09SnapTestKeyID,
		RollbackVersion: rollback,
	}
	if err := S09SignSnapshot(&snap, priv); err != nil {
		t.Fatalf("sign: %v", err)
	}
	return snap
}

func s09BuildImportRaw(t *testing.T, snap CommunityKnowledgeSnapshot, now time.Time) []byte {
	t.Helper()
	env := S09SnapshotRequest{
		SchemaVersion: S09SchemaVersion,
		RequestID:     "req-snap-001",
		Provenance:    s09SnapProvenance(now),
		Snapshot:      snap,
	}
	b, err := json.Marshal(env)
	if err != nil {
		t.Fatalf("marshal import: %v", err)
	}
	return b
}

func TestS09Snapshot_ValidSignatureImport(t *testing.T) {
	keys, priv := s09SnapTestKeys(t)
	store := NewS09SnapshotStore(keys)
	now := s09TestNow
	snap := s09BuildSignedSnapshot(t, priv, 1, 0, now)
	resp := store.Import(s09BuildImportRaw(t, snap, now), now)
	if resp.Error != nil {
		t.Fatalf("expected success, got %#v", resp.Error)
	}
	if resp.Authority != S09SnapshotAuthority {
		t.Fatalf("authority=%q want %q", resp.Authority, S09SnapshotAuthority)
	}
	if resp.Result == nil || resp.Result.SnapshotVersion != 1 {
		t.Fatalf("result=%#v", resp.Result)
	}
	if store.Current() == nil || store.Prior() != nil {
		t.Fatal("first import should set current and leave prior nil")
	}
}

func TestS09Snapshot_InvalidSignatureNoStateChange(t *testing.T) {
	keys, priv := s09SnapTestKeys(t)
	store := NewS09SnapshotStore(keys)
	now := s09TestNow
	// Seed a valid current so we can prove reject leaves it alone.
	ok := s09BuildSignedSnapshot(t, priv, 1, 0, now)
	if resp := store.Import(s09BuildImportRaw(t, ok, now), now); resp.Error != nil {
		t.Fatalf("seed: %#v", resp.Error)
	}
	before := store.Current().SnapshotVersion

	bad := s09BuildSignedSnapshot(t, priv, 2, 1, now)
	bad.Signature = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=="
	resp := store.Import(s09BuildImportRaw(t, bad, now), now)
	if resp.Error == nil || resp.Error.ErrorCode != "policy_rejected" || resp.Error.RuleClass != "signature" {
		t.Fatalf("expected signature reject, got %#v", resp.Error)
	}
	if store.Current().SnapshotVersion != before || store.Prior() != nil {
		t.Fatal("invalid signature must not change state")
	}
}

func TestS09Snapshot_ExpiredNoStateChange(t *testing.T) {
	keys, priv := s09SnapTestKeys(t)
	store := NewS09SnapshotStore(keys)
	now := s09TestNow
	snap := s09BuildSignedSnapshot(t, priv, 1, 0, now)
	snap.ValidFrom = now.Add(-48 * time.Hour)
	snap.ExpiresAt = now.Add(-time.Hour)
	if err := S09SignSnapshot(&snap, priv); err != nil {
		t.Fatal(err)
	}
	resp := store.Import(s09BuildImportRaw(t, snap, now), now)
	if resp.Error == nil || resp.Error.ErrorCode != "policy_rejected" || resp.Error.RuleClass != "expired" {
		t.Fatalf("expected expired reject, got %#v", resp.Error)
	}
	if store.Current() != nil {
		t.Fatal("expired import must leave store empty")
	}
}

func TestS09Snapshot_UnknownKeyNoStateChange(t *testing.T) {
	keys, priv := s09SnapTestKeys(t)
	store := NewS09SnapshotStore(keys)
	now := s09TestNow
	snap := s09BuildSignedSnapshot(t, priv, 1, 0, now)
	snap.KeyID = "not-allowlisted"
	if err := S09SignSnapshot(&snap, priv); err != nil {
		t.Fatal(err)
	}
	resp := store.Import(s09BuildImportRaw(t, snap, now), now)
	if resp.Error == nil || resp.Error.ErrorCode != "policy_rejected" || resp.Error.RuleClass != "unknown-key" {
		t.Fatalf("expected unknown-key reject, got %#v", resp.Error)
	}
	if store.Current() != nil {
		t.Fatal("unknown-key import must leave store empty")
	}
}

func TestS09Snapshot_ReplayAndVersionConflict(t *testing.T) {
	keys, priv := s09SnapTestKeys(t)
	store := NewS09SnapshotStore(keys)
	now := s09TestNow

	v1 := s09BuildSignedSnapshot(t, priv, 1, 0, now)
	if resp := store.Import(s09BuildImportRaw(t, v1, now), now); resp.Error != nil {
		t.Fatalf("v1: %#v", resp.Error)
	}

	// Exact replay / same version → 409, no state change.
	replay := s09BuildSignedSnapshot(t, priv, 1, 0, now)
	resp := store.Import(s09BuildImportRaw(t, replay, now), now)
	if resp.Error == nil || resp.Error.ErrorCode != "duplicate_or_conflict" {
		t.Fatalf("expected version conflict on replay, got %#v", resp.Error)
	}
	if store.Prior() != nil || store.Current().SnapshotVersion != 1 {
		t.Fatal("replay must not mutate prior/current")
	}

	// Older / non-monotonic version → 409.
	older := s09BuildSignedSnapshot(t, priv, 1, 1, now)
	resp = store.Import(s09BuildImportRaw(t, older, now), now)
	if resp.Error == nil || resp.Error.ErrorCode != "duplicate_or_conflict" {
		t.Fatalf("expected non-monotonic conflict, got %#v", resp.Error)
	}

	// Wrong rollback reference → invalid_payload, no state change.
	badRollback := s09BuildSignedSnapshot(t, priv, 2, 99, now)
	resp = store.Import(s09BuildImportRaw(t, badRollback, now), now)
	if resp.Error == nil || resp.Error.ErrorCode != "invalid_payload" || resp.Error.RuleClass != "rollback-reference" {
		t.Fatalf("expected rollback-reference reject, got %#v", resp.Error)
	}
	if store.Current().SnapshotVersion != 1 || store.Prior() != nil {
		t.Fatal("bad rollback reference must not change state")
	}
}

func TestS09Snapshot_AtomicRollback(t *testing.T) {
	keys, priv := s09SnapTestKeys(t)
	dir := t.TempDir()
	path := filepath.Join(dir, "s09-snapshot.jsonl")
	store, err := OpenS09SnapshotStore(path, keys)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	now := s09TestNow

	v1 := s09BuildSignedSnapshot(t, priv, 1, 0, now)
	if resp := store.Import(s09BuildImportRaw(t, v1, now), now); resp.Error != nil {
		t.Fatalf("v1: %#v", resp.Error)
	}
	v2 := s09BuildSignedSnapshot(t, priv, 2, 1, now)
	v2.SnapshotID = "snap-002"
	if err := S09SignSnapshot(&v2, priv); err != nil {
		t.Fatal(err)
	}
	if resp := store.Import(s09BuildImportRaw(t, v2, now), now); resp.Error != nil {
		t.Fatalf("v2: %#v", resp.Error)
	}
	if store.Current().SnapshotVersion != 2 || store.Prior().SnapshotVersion != 1 {
		t.Fatalf("after v2: current=%v prior=%v", store.Current(), store.Prior())
	}

	rb := store.Rollback("req-rollback-1", now)
	if rb.Error != nil {
		t.Fatalf("rollback: %#v", rb.Error)
	}
	if rb.Result.SnapshotVersion != 1 || store.Current().SnapshotVersion != 1 {
		t.Fatalf("rollback result=%v current=%v", rb.Result, store.Current())
	}
	if store.Prior() != nil {
		t.Fatal("prior must clear after successful rollback")
	}

	// Second rollback fails closed.
	rb2 := store.Rollback("req-rollback-2", now)
	if rb2.Error == nil || rb2.Error.RuleClass != "no-prior" {
		t.Fatalf("expected no-prior, got %#v", rb2.Error)
	}
	if store.Current().SnapshotVersion != 1 {
		t.Fatal("failed rollback must not change current")
	}

	// Crash rebuild restores rolled-back state.
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := OpenS09SnapshotStore(path, keys)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if reopened.Current() == nil || reopened.Current().SnapshotVersion != 1 {
		t.Fatalf("reopened current=%v", reopened.Current())
	}
	if reopened.Prior() != nil {
		t.Fatal("reopened prior should be nil after rollback checkpoint")
	}
}

func TestS09Snapshot_MissingProvenanceRejected(t *testing.T) {
	keys, priv := s09SnapTestKeys(t)
	store := NewS09SnapshotStore(keys)
	now := s09TestNow
	snap := s09BuildSignedSnapshot(t, priv, 1, 0, now)
	env := map[string]any{
		"schemaVersion": S09SchemaVersion,
		"requestId":     "req-no-prov",
		"provenance":    map[string]any{"producer": "", "derivationRevision": "", "observedAt": "0001-01-01T00:00:00Z"},
		"snapshot":      snap,
	}
	raw, _ := json.Marshal(env)
	resp := store.Import(raw, now)
	if resp.Error == nil || resp.Error.RuleClass != "provenance" {
		t.Fatalf("expected provenance reject, got %#v", resp.Error)
	}
}
