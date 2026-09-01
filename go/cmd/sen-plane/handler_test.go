package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"agentic-os/internal/localdb/product"
	"agentic-os/internal/orca"
)

// newTestHandler opens fresh orca + product stores on a temp root and returns
// the handler bound to them — mirroring main()'s startup, minus process exit.
func newTestHandler(t *testing.T) http.Handler {
	t.Helper()
	store, chat := newTestStores(t)
	return NewHandler(&storeSource{store: store}, chat)
}

func newTestStores(t *testing.T) (*orca.Store, *sql.DB) {
	t.Helper()
	root := filepath.Join(t.TempDir(), "store")
	store, err := orca.Open(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	chat, err := product.Open(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { chat.Close() })
	return store, chat
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

	ts := httptest.NewServer(NewHandler(&storeSource{store: store}, nil))
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

	ts := httptest.NewServer(NewHandler(&storeSource{store: store}, nil))
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

func TestSenChatPostsTurnAndReadsBackViaListTurnsAfter(t *testing.T) {
	store, chat := newTestStores(t)
	ts := httptest.NewServer(NewHandler(&storeSource{store: store}, chat))
	defer ts.Close()

	res, err := http.Post(ts.URL+"/api/v1/sen/chat", "application/json",
		strings.NewReader(`{"session_id":"s-1","sender":"user","text":"hello from http"}`))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status %d", res.StatusCode)
	}
	var out SenChatTurnResponse
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	if out.CommandID == "" || out.SessionID != "s-1" || out.TurnSeq != 1 || out.CreatedAt == "" {
		t.Fatalf("unexpected receipt: %+v", out)
	}

	turns, err := product.ListTurnsAfter(context.Background(), chat, "s-1", 0, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(turns) != 1 {
		t.Fatalf("turns = %+v", turns)
	}
	turn := turns[0]
	if turn.Content != "hello from http" || turn.Role != "user" || turn.TurnSeq != out.TurnSeq {
		t.Errorf("turn = %+v, want content/role/seq to match %+v", turn, out)
	}
	if turn.ClientCommandID == nil || *turn.ClientCommandID != out.CommandID {
		t.Errorf("client_command_id = %v, want %q", turn.ClientCommandID, out.CommandID)
	}
}

func TestSenChatBadRequestShapes(t *testing.T) {
	ts := httptest.NewServer(newTestHandler(t))
	defer ts.Close()
	for _, body := range []string{
		`{"session_id":"","sender":"user","text":"x"}`,
		`{"session_id":"s-1","sender":"bot","text":"x"}`,
		`{"session_id":"s-1","sender":"user","text":""}`,
		`{"session_id":"s-1","sender":"user"}`,
		`not json`,
	} {
		res, err := http.Post(ts.URL+"/api/v1/sen/chat", "application/json", strings.NewReader(body))
		if err != nil {
			t.Fatalf("%s: %v", body, err)
		}
		res.Body.Close()
		if res.StatusCode != http.StatusBadRequest {
			t.Errorf("body %q: status %d, want 400", body, res.StatusCode)
		}
	}
}

func TestSenChatStoreUnavailable(t *testing.T) {
	store, err := orca.Open(context.Background(), filepath.Join(t.TempDir(), "store"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	ts := httptest.NewServer(NewHandler(&storeSource{store: store}, nil)) // no product store
	defer ts.Close()

	res, err := http.Post(ts.URL+"/api/v1/sen/chat", "application/json",
		strings.NewReader(`{"session_id":"s-1","sender":"user","text":"x"}`))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("status %d, want 503", res.StatusCode)
	}
}

func TestSenChatGetReadsBackSessionsAndTurns(t *testing.T) {
	ts := httptest.NewServer(newTestHandler(t))
	defer ts.Close()

	// A user turn then an assistant turn across one session, plus one other
	// session, exercised the POST path before the reads below.
	for i, body := range []string{
		`{"session_id":"s-view","sender":"user","text":"first"}`,
		`{"session_id":"s-view","sender":"assistant","text":"reply"}`,
		`{"session_id":"s-other","sender":"user","text":"other"}`,
	} {
		res, err := http.Post(ts.URL+"/api/v1/sen/chat", "application/json", strings.NewReader(body))
		if err != nil {
			t.Fatalf("post %d: %v", i, err)
		}
		res.Body.Close()
		if res.StatusCode != http.StatusOK {
			t.Fatalf("post %d: status %d", i, res.StatusCode)
		}
	}

	// ?session=<id> returns the ordered thread with role/text/ts rows.
	res, err := http.Get(ts.URL + "/api/v1/sen/chat?session=s-view")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("thread status %d", res.StatusCode)
	}
	var thread struct {
		Turns []struct {
			Role string `json:"role"`
			Text string `json:"text"`
			TS   string `json:"ts"`
		} `json:"turns"`
	}
	if err := json.NewDecoder(res.Body).Decode(&thread); err != nil {
		t.Fatal(err)
	}
	if len(thread.Turns) != 2 || thread.Turns[0].Role != "user" || thread.Turns[0].Text != "first" ||
		thread.Turns[1].Role != "assistant" || thread.Turns[1].Text != "reply" {
		t.Fatalf("thread = %+v", thread.Turns)
	}
	if thread.Turns[0].TS == "" || thread.Turns[1].TS == "" {
		t.Fatalf("missing ts on thread turns: %+v", thread.Turns)
	}

	// No ?session -> session list with id/title, most recent first.
	res, err = http.Get(ts.URL + "/api/v1/sen/chat")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("list status %d", res.StatusCode)
	}
	var list struct {
		Sessions []struct {
			ID string `json:"id"`
		} `json:"sessions"`
	}
	if err := json.NewDecoder(res.Body).Decode(&list); err != nil {
		t.Fatal(err)
	}
	ids := []string{}
	for _, s := range list.Sessions {
		ids = append(ids, s.ID)
	}
	// s-other posted last, so it must sort first by updated_at.
	if len(ids) != 2 || ids[0] != "s-other" || ids[1] != "s-view" {
		t.Fatalf("sessions = %+v", ids)
	}
}

func TestSenChatGetStoreUnavailable(t *testing.T) {
	store, err := orca.Open(context.Background(), filepath.Join(t.TempDir(), "store"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	ts := httptest.NewServer(NewHandler(&storeSource{store: store}, nil)) // no product store
	defer ts.Close()

	res, err := http.Get(ts.URL + "/api/v1/sen/chat")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("status %d, want 503", res.StatusCode)
	}
}