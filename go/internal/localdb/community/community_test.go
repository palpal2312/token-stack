package community

import (
	"fmt"
	"sync"
	"testing"
)

func TestCommunityQueue_EnqueueAndLifecycle(t *testing.T) {
	store := NewMemoryCommunityStore()

	item := QueueItem{
		ID:         "item-001",
		Title:      "Awesome L2 Plugin",
		PluginSlug: "awesome-l2-plugin",
		AuthorRef:  "usr-lane2-001",
		Version:    "1.0.0",
		Metadata: map[string]string{
			"category": "developer-tools",
			"license":  "MIT",
			"repo_ref": "https://github.com/example/repo",
		},
	}

	err := store.Enqueue(item)
	if err != nil {
		t.Fatalf("Enqueue failed: %v", err)
	}

	got, err := store.Get("item-001")
	if err != nil || got == nil {
		t.Fatalf("Get failed: %v", err)
	}
	if got.State != StateQueued {
		t.Fatalf("expected state queued, got %q", got.State)
	}

	// Normal lifecycle progression: queued -> sanitizing -> approved -> exporting -> exported
	if err := store.Transition("item-001", StateSanitizing); err != nil {
		t.Fatalf("transition to sanitizing failed: %v", err)
	}
	if err := store.Transition("item-001", StateApproved); err != nil {
		t.Fatalf("transition to approved failed: %v", err)
	}

	envelope, err := store.Export("item-001")
	if err != nil {
		t.Fatalf("Export failed: %v", err)
	}
	if envelope.Checksum == "" {
		t.Fatal("expected non-empty envelope checksum")
	}
	if envelope.PluginSlug != "awesome-l2-plugin" {
		t.Fatalf("expected plugin slug awesome-l2-plugin, got %q", envelope.PluginSlug)
	}

	finalItem, _ := store.Get("item-001")
	if finalItem.State != StateExported {
		t.Fatalf("expected final state exported, got %q", finalItem.State)
	}
}

func TestCommunityQueue_SanitizerAllowlistAndRedaction(t *testing.T) {
	store := NewMemoryCommunityStore()

	// Disallowed key
	itemDisallowed := QueueItem{
		ID:         "item-bad-key",
		PluginSlug: "plugin-bad",
		AuthorRef:  "usr-01",
		Metadata: map[string]string{
			"raw_prompt": "some injected system prompt",
		},
	}
	err := store.Enqueue(itemDisallowed)
	if err == nil {
		t.Fatal("expected error for disallowed metadata key 'raw_prompt'")
	}

	// Secret in value
	itemSecret := QueueItem{
		ID:         "item-secret",
		PluginSlug: "plugin-secret",
		AuthorRef:  "usr-02",
		Metadata: map[string]string{
			"doc_ref": "https://example.com/doc?token=Bearer secret-1234567890",
		},
	}
	err = store.Enqueue(itemSecret)
	if err == nil {
		t.Fatal("expected error for secret pattern in metadata value")
	}
}

func TestCommunityQueue_QuarantineIsolation(t *testing.T) {
	store := NewMemoryCommunityStore()

	// Enqueue valid item 1
	_ = store.Enqueue(QueueItem{
		ID:         "item-1",
		PluginSlug: "p1",
		AuthorRef:  "u1",
		Metadata:   map[string]string{"category": "ai"},
	})

	// Enqueue item 2 (which will be quarantined)
	_ = store.Enqueue(QueueItem{
		ID:         "item-2",
		PluginSlug: "p2",
		AuthorRef:  "u2",
		Metadata:   map[string]string{"category": "ai"},
	})

	// Enqueue valid item 3
	_ = store.Enqueue(QueueItem{
		ID:         "item-3",
		PluginSlug: "p3",
		AuthorRef:  "u3",
		Metadata:   map[string]string{"category": "ai"},
	})

	// Quarantine item 2
	err := store.Quarantine("item-2", "Malicious manifest metadata", "ERR_POLICY_VIOLATION")
	if err != nil {
		t.Fatalf("Quarantine failed: %v", err)
	}

	// Invariant check: ListPending must include item-1 and item-3, but NOT item-2
	pending, err := store.ListPending()
	if err != nil {
		t.Fatalf("ListPending failed: %v", err)
	}
	if len(pending) != 2 {
		t.Fatalf("expected 2 pending items, got %d", len(pending))
	}
	for _, p := range pending {
		if p.ID == "item-2" {
			t.Fatal("quarantined item-2 must not appear in pending queue")
		}
	}

	// Verify item-1 and item-3 can proceed to export unblocked
	_ = store.Transition("item-1", StateSanitizing)
	_ = store.Transition("item-1", StateApproved)
	env1, err := store.Export("item-1")
	if err != nil || env1 == nil {
		t.Fatalf("item-1 export failed after quarantine of item-2: %v", err)
	}
}

func TestCommunityQueue_AsyncExportCandidateIngestion(t *testing.T) {
	store := NewMemoryCommunityStore()

	// 1. Ingest valid candidate without author/plugin
	cand := ProductExportCandidate{
		ID:           "mem-cand-01",
		SourceType:   "product-export",
		ContentHash:  "hash-mem-01",
		RawPayload:   `{"data":"clean"}`,
		Metadata: map[string]string{
			"category": "developer-tools",
		},
	}
	item, err := store.IngestExportCandidate(cand)
	if err != nil || item == nil {
		t.Fatalf("IngestExportCandidate failed: %v", err)
	}
	if item.Status != StatusPending {
		t.Fatalf("expected status pending, got %q", item.Status)
	}

	// 2. Idempotent replay
	dupItem, err := store.IngestExportCandidate(cand)
	if err != nil || dupItem.ID != item.ID {
		t.Fatalf("idempotent replay mismatch: %+v vs %+v, err: %v", dupItem, item, err)
	}

	// 3. Sanitizer quarantine on secret
	badCand := ProductExportCandidate{
		ID:          "mem-cand-bad",
		ContentHash: "hash-bad",
		RawPayload:  `{"secret":"Bearer leaked-api-key"}`,
	}
	badItem, err := store.IngestExportCandidate(badCand)
	if err != nil || badItem == nil {
		t.Fatalf("ingest bad candidate failed: %v", err)
	}
	if badItem.Status != StatusQuarantined {
		t.Fatalf("expected quarantined status, got %q", badItem.Status)
	}

	// 4. Pending list must exclude quarantined item
	pending, err := store.ListPending()
	if err != nil {
		t.Fatalf("ListPending failed: %v", err)
	}
	if len(pending) != 1 || pending[0].ID != "mem-cand-01" {
		t.Fatalf("expected only mem-cand-01 in pending, got %d items: %+v", len(pending), pending)
	}
}

func TestCommunityQueue_QuarantineAndTombstoneStateGuards(t *testing.T) {
	store := NewMemoryCommunityStore()

	item := QueueItem{
		ID:         "guard-001",
		PluginSlug: "guard-plugin",
		AuthorRef:  "usr-01",
		Metadata:   map[string]string{"category": "test"},
	}
	if err := store.Enqueue(item); err != nil {
		t.Fatalf("Enqueue failed: %v", err)
	}

	// 1. Pre-terminal quarantine works
	if err := store.Quarantine("guard-001", "Policy breach", "ERR_POLICY"); err != nil {
		t.Fatalf("pre-terminal quarantine failed: %v", err)
	}
	got, _ := store.Get("guard-001")
	if got.Status != StatusQuarantined || got.State != StatusQuarantined {
		t.Fatalf("expected quarantined status, got status=%q, state=%q", got.Status, got.State)
	}

	// 2. Same quarantine retry is idempotent
	if err := store.Quarantine("guard-001", "Policy breach", "ERR_POLICY"); err != nil {
		t.Fatalf("idempotent quarantine retry failed: %v", err)
	}

	// 3. Incompatible quarantine retry fails
	if err := store.Quarantine("guard-001", "Different reason", "ERR_DIFFERENT"); err == nil {
		t.Fatal("expected error on incompatible quarantine retry")
	}

	// 4. Quarantined can transition to Rejected (terminal)
	if err := store.Transition("guard-001", StatusRejected); err != nil {
		t.Fatalf("transition to rejected failed: %v", err)
	}
	gotTerm, _ := store.Get("guard-001")
	if gotTerm.Status != StatusRejected || gotTerm.State != StatusRejected {
		t.Fatalf("expected rejected status, got status=%q, state=%q", gotTerm.Status, gotTerm.State)
	}

	// 5. Terminal rejected cannot become quarantined or pending
	if err := store.Quarantine("guard-001", "Attempt quarantine after reject", "ERR_REJECT"); err == nil {
		t.Fatal("expected error when attempting to quarantine terminal rejected item")
	}
	if err := store.Transition("guard-001", StatusPending); err == nil {
		t.Fatal("expected error when attempting to transition terminal rejected item to pending")
	}
	if err := store.Transition("guard-001", StatusSanitizing); err == nil {
		t.Fatal("expected error when attempting to transition terminal rejected item to sanitizing")
	}
}

func TestCommunityQueue_Concurrency(t *testing.T) {
	store := NewMemoryCommunityStore()
	var wg sync.WaitGroup

	for i := 0; i < 30; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			id := fmt.Sprintf("concurrent-item-%d", idx)
			_ = store.Enqueue(QueueItem{
				ID:         id,
				PluginSlug: fmt.Sprintf("plugin-%d", idx),
				AuthorRef:  "usr-concurrent",
				Metadata:   map[string]string{"tag": "test"},
			})
			_ = store.Transition(id, StateSanitizing)
			_ = store.Transition(id, StateApproved)
			_, _ = store.Export(id)
		}(i)
	}

	wg.Wait()
}
