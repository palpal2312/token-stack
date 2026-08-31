package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"agentic-os/internal/orca"
)

// newTestHandler opens a fresh orca store on a temp root and returns the
// handler bound to it — mirroring main()'s fail-closed startup, minus the
// process exit.
func newTestHandler(t *testing.T) http.Handler {
	t.Helper()
	store, err := orca.Open(context.Background(), filepath.Join(t.TempDir(), "store"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	return NewHandler(&storeSource{store: store})
}

func TestRuntimeSlotsEmptyOnFreshStore(t *testing.T) {
	ts := httptest.NewServer(newTestHandler(t))
	defer ts.Close()

	res, err := http.Get(ts.URL + "/api/v1/runtime/slots")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status %d", res.StatusCode)
	}
	var dto RuntimeSlotsDTO
	if err := json.NewDecoder(res.Body).Decode(&dto); err != nil {
		t.Fatal(err)
	}
	if dto.DTOVersion != orca.DTOVersion {
		t.Errorf("dto_version = %d", dto.DTOVersion)
	}
	if !dto.LabEnabled {
		t.Error("lab_enabled = false")
	}
	if dto.Slots == nil || len(dto.Slots) != 0 {
		t.Errorf("expected empty slots on fresh store, got %+v", dto.Slots)
	}
}

func TestRuntimeSlotsLiveFromStore(t *testing.T) {
	store, err := orca.Open(context.Background(), filepath.Join(t.TempDir(), "store"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	now := time.Date(2026, 9, 1, 10, 0, 0, 0, time.UTC)
	if _, err := store.ClaimDispatch(context.Background(), orca.ClaimInput{
		DispatchID: "ctx_live_1", RunID: "run_1", TaskID: "task_1",
		TerminalHandle: "term_1", Now: now,
	}); err != nil {
		t.Fatal(err)
	}

	ts := httptest.NewServer(NewHandler(&storeSource{store: store}))
	defer ts.Close()
	res, err := http.Get(ts.URL + "/api/v1/runtime/slots")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status %d", res.StatusCode)
	}
	var dto RuntimeSlotsDTO
	if err := json.NewDecoder(res.Body).Decode(&dto); err != nil {
		t.Fatal(err)
	}
	if len(dto.Slots) != 1 {
		t.Fatalf("expected 1 slot from live dispatch, got %+v", dto.Slots)
	}
	if dto.Slots[0].State != orca.SlotLaunching {
		t.Errorf("state = %s, want launching", dto.Slots[0].State)
	}
	if dto.Slots[0].AttemptRef == nil || *dto.Slots[0].AttemptRef != "ctx_live_1" {
		t.Errorf("attempt_ref = %v", dto.Slots[0].AttemptRef)
	}
	raw, _ := json.Marshal(dto.Slots)
	for _, key := range []string{"token", "secret", "password", "command", "private"} {
		if bytes.Contains(raw, []byte(key)) {
			t.Errorf("slot payload leaked key substring %q", key)
		}
	}
}

func TestRuntimeAttemptsProjection(t *testing.T) {
	store, err := orca.Open(context.Background(), filepath.Join(t.TempDir(), "store"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	now := time.Date(2026, 9, 1, 10, 0, 0, 0, time.UTC)
	if _, err := store.ClaimDispatch(context.Background(), orca.ClaimInput{
		DispatchID: "ctx_live_1", RunID: "run_1", TaskID: "task_1",
		TerminalHandle: "term_1", Now: now,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Complete(context.Background(), "ctx_live_1", orca.StatusFailed, now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}

	ts := httptest.NewServer(NewHandler(&storeSource{store: store}))
	defer ts.Close()
	res, err := http.Get(ts.URL + "/api/v1/runtime/attempts")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status %d", res.StatusCode)
	}
	var proj RuntimeProjectionDTO
	if err := json.NewDecoder(res.Body).Decode(&proj); err != nil {
		t.Fatal(err)
	}
	if len(proj.Attempts) != 1 {
		t.Fatalf("expected 1 attempt, got %+v", proj.Attempts)
	}
	a := proj.Attempts[0]
	if a.AttemptID != "ctx_live_1" || a.TaskID != "task_1" {
		t.Errorf("attempt ids = %s/%s", a.AttemptID, a.TaskID)
	}
	if a.Status != "failed" {
		t.Errorf("status = %q, want failed", a.Status)
	}
	if a.LeaseGeneration <= 0 {
		t.Errorf("lease_generation = %d", a.LeaseGeneration)
	}
	for _, nonEmpty := range []string{a.BuilderID, a.PaneID, a.AttachedAt, a.LastHeartbeatAt, a.TerminalAt} {
		if nonEmpty == "" {
			t.Errorf("attempt field empty: %+v", a)
		}
	}
}

func TestAttemptsEmptyOnFreshStore(t *testing.T) {
	ts := httptest.NewServer(newTestHandler(t))
	defer ts.Close()
	res, err := http.Get(ts.URL + "/api/v1/runtime/attempts")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var proj RuntimeProjectionDTO
	if err := json.NewDecoder(res.Body).Decode(&proj); err != nil {
		t.Fatal(err)
	}
	if proj.Attempts == nil || len(proj.Attempts) != 0 {
		t.Errorf("expected empty attempts on fresh store, got %+v", proj.Attempts)
	}
}

func TestPhase1bEndpointsParse(t *testing.T) {
	ts := httptest.NewServer(newTestHandler(t))
	defer ts.Close()
	for _, tc := range []struct{ path, wantField string }{
		{"/api/v1/runtime/attempts", "projection_version"},
		{"/api/v1/codespace/summary", "projection_version"},
		{"/api/v1/workspace/w1/execution-preference", "workspace_id"},
	} {
		res, err := http.Get(ts.URL + tc.path)
		if err != nil {
			t.Fatalf("%s: %v", tc.path, err)
		}
		body := map[string]any{}
		if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
			t.Fatalf("%s: decode: %v", tc.path, err)
		}
		res.Body.Close()
		if res.StatusCode != http.StatusOK {
			t.Fatalf("%s: status %d", tc.path, res.StatusCode)
		}
		if _, ok := body[tc.wantField]; !ok {
			t.Errorf("%s: missing %q in %v", tc.path, tc.wantField, body)
		}
	}
}

func TestHealthz(t *testing.T) {
	ts := httptest.NewServer(newTestHandler(t))
	defer ts.Close()
	res, err := http.Get(ts.URL + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status %d", res.StatusCode)
	}
}