package memory

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

var fixed = time.Date(2026, 8, 26, 12, 0, 0, 0, time.UTC)

func ingest(t *testing.T, store *Store, kind Kind, content, source string, readers ...string) Record {
	t.Helper(); record, err := store.Ingest(IngestRequest{Kind: kind, Content: content, ACL: ACL{Readers: readers}, SourceID: source, SourceURI: "local://source", ObservedAt: fixed, ItemCount: 1}, ParserCaps{})
	if err != nil { t.Fatal(err) }; return record
}

func TestACLBeforeRankingAndDeterministicPack(t *testing.T) {
	store := NewStore()
	ingest(t, store, Semantic, "alpha alpha alpha private", "s-private", "other")
	allowed := ingest(t, store, Procedural, "alpha public procedure", "s-public", "owner")
	first, err := store.BuildContextPack("owner", "alpha", 10); if err != nil { t.Fatal(err) }
	second, _ := store.BuildContextPack("owner", "alpha", 10)
	if first.PackHash != second.PackHash { t.Fatal("pack hash is not deterministic") }
	if len(first.Items) != 1 || first.Citations[0].RecordID != allowed.ID { t.Fatalf("unauthorized record reached ranking: %#v", first) }
	if err := ValidatePack(first); err != nil { t.Fatal(err) }
}

func TestSupersessionCorrectionAuditDeletionAndExport(t *testing.T) {
	store := NewStore(); original := ingest(t, store, Episodic, "old fact", "src", "owner")
	corrected, err := store.Correct(original.ID, "new fact", fixed.Add(time.Minute)); if err != nil { t.Fatal(err) }
	if got := store.Search("owner", "old", SearchOptions{}); len(got) != 0 { t.Fatal("superseded record was searchable") }
	if exported := store.Export("owner"); len(exported) != 1 || exported[0].ID != corrected.ID { t.Fatal("export included wrong lifecycle state") }
	if err := store.Delete(corrected.ID, fixed.Add(2*time.Minute)); err != nil { t.Fatal(err) }
	if len(store.Export("owner")) != 0 { t.Fatal("deleted content was exported") }
	audit := store.Audit(); if audit[1].Action != "correct" || audit[1].RelatedID != original.ID || audit[2].Action != "delete" { t.Fatalf("audit lineage incomplete: %#v", audit) }
}

func TestQuarantineParserCapsRedactionAndSafeErrors(t *testing.T) {
	store := NewStore()
	quarantined, err := store.Ingest(IngestRequest{Kind: Working, Content: "untrusted", ACL: ACL{Readers: []string{"owner"}}, ObservedAt: fixed}, ParserCaps{}); if err != nil { t.Fatal(err) }
	if quarantined.State != Quarantined || len(store.Search("owner", "untrusted", SearchOptions{})) != 0 { t.Fatal("unprovenanced content escaped quarantine") }
	secret := ingest(t, store, Working, "token=[redacted-value] safe", "src", "owner")
	if strings.Contains(secret.Content, "redacted-value") || len(secret.RedactionTags) != 1 { t.Fatal("secret was not redacted") }
	_, err = store.Ingest(IngestRequest{Kind: Working, Content: strings.Repeat("x", 9), ACL: ACL{Readers: []string{"owner"}}, SourceID: "src", ObservedAt: fixed}, ParserCaps{MaxBytes: 8, MaxItems: 1})
	data, _ := json.Marshal(err); if strings.Contains(string(data), strings.Repeat("x", 9)) || !strings.Contains(string(data), "PARSER_CAP_EXCEEDED") { t.Fatalf("unsafe error envelope: %s", data) }
}

func TestStaleSourceFTSFallbackRebuildAndIdempotency(t *testing.T) {
	store := NewStore(); first := ingest(t, store, Semantic, "rebuildable knowledge", "src", "owner"); replay := ingest(t, store, Semantic, "rebuildable knowledge", "src", "owner")
	if first.ID != replay.ID || len(store.Audit()) != 1 { t.Fatal("ingestion replay was not idempotent") }
	if store.MarkSourceStale("src", fixed.Add(time.Hour)) != 1 { t.Fatal("stale source was not marked") }
	if got := store.Search("owner", "knowledge", SearchOptions{ForceFTSFallback: true}); len(got) != 1 || !got[0].Record.StaleSource { t.Fatal("fallback omitted stale-source marker") }
	store.index = map[string]map[string]struct{}{}; store.RebuildProjection()
	if got := store.Search("owner", "knowledge", SearchOptions{}); len(got) != 1 { t.Fatal("projection rebuild failed") }
}

func TestMemoryKindBoundariesAndPackTampering(t *testing.T) {
	store := NewStore()
	for _, kind := range []Kind{Working, Episodic, Semantic, Procedural} { record := ingest(t, store, kind, "boundary "+string(kind), "src-"+string(kind), "owner"); if record.Kind != kind { t.Fatal("kind boundary changed") } }
	pack, _ := store.BuildContextPack("owner", "boundary", 10); pack.Items[0].Content = "tampered"
	if ValidatePack(pack) == nil { t.Fatal("tampered citation was accepted") }
}
