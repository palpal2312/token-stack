package sandbox

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// ---------- AgentENVClient tests ----------

func TestDigestPinnedImageReference(t *testing.T) {
	img := DigestPinnedImage{
		Repository: "ghcr.io/agent-os/sandbox-runtime",
		Digest:     "sha256:abcdef1234567890",
	}
	want := "ghcr.io/agent-os/sandbox-runtime@sha256:abcdef1234567890"
	if got := img.Reference(); got != want {
		t.Errorf("Reference() = %q, want %q", got, want)
	}
}

func TestCreateSandbox(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST, got %s", r.Method)
		}
		if r.URL.Path != "/api/v1/sandboxes" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer test-token" {
			t.Errorf("missing auth header")
		}

		var req CreateSandboxRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if req.SandboxID != "sbx-1" {
			t.Errorf("unexpected sandbox_id: %s", req.SandboxID)
		}

		resp := CreateSandboxResponse{
			SandboxID:   req.SandboxID,
			ContainerID: "ctr-abc123",
			Status:      "created",
			CreatedAt:   "2026-08-08T00:00:00Z",
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer ts.Close()

	client := NewAgentENVClient(ts.URL, WithAuthToken("test-token"))
	resp, err := client.CreateSandbox(context.Background(), CreateSandboxRequest{
		SandboxID: "sbx-1",
		Image: DigestPinnedImage{
			Repository: "ghcr.io/agent-os/rt",
			Digest:     "sha256:aaa",
		},
		MemoryMB:    512,
		NetworkMode: "none",
	})
	if err != nil {
		t.Fatalf("CreateSandbox: %v", err)
	}
	if resp.ContainerID != "ctr-abc123" {
		t.Errorf("unexpected container_id: %s", resp.ContainerID)
	}
}

func TestDestroySandbox(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			t.Errorf("expected DELETE, got %s", r.Method)
		}
		if r.URL.Path != "/api/v1/sandboxes/sbx-1" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer ts.Close()

	client := NewAgentENVClient(ts.URL)
	err := client.DestroySandbox(context.Background(), DestroySandboxRequest{
		SandboxID: "sbx-1",
		Force:     true,
	})
	if err != nil {
		t.Fatalf("DestroySandbox: %v", err)
	}
}

func TestExecInSandbox(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/sandboxes/sbx-2/exec" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		resp := ExecInSandboxResponse{
			ExitCode: 0,
			Stdout:   "hello world\n",
			Stderr:   "",
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer ts.Close()

	client := NewAgentENVClient(ts.URL)
	resp, err := client.ExecInSandbox(context.Background(), ExecInSandboxRequest{
		SandboxID: "sbx-2",
		Command:   []string{"echo", "hello world"},
	})
	if err != nil {
		t.Fatalf("ExecInSandbox: %v", err)
	}
	if resp.ExitCode != 0 {
		t.Errorf("exit code = %d, want 0", resp.ExitCode)
	}
	if resp.Stdout != "hello world\n" {
		t.Errorf("stdout = %q", resp.Stdout)
	}
}

func TestAPIErrorResponse(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(`{"error":"internal failure"}`))
	}))
	defer ts.Close()

	client := NewAgentENVClient(ts.URL)
	_, err := client.CreateSandbox(context.Background(), CreateSandboxRequest{SandboxID: "sbx-err"})
	if err == nil {
		t.Fatal("expected error for 500 response")
	}
	apiErr, ok := err.(*AgentENVAPIError)
	if !ok {
		// The error is wrapped, so unwrap it.
		t.Logf("error type: %T, message: %v", err, err)
	} else {
		if apiErr.StatusCode != 500 {
			t.Errorf("status = %d, want 500", apiErr.StatusCode)
		}
	}
}

func TestWithHTTPClient(t *testing.T) {
	custom := &http.Client{Timeout: 60 * 1000000000} // 60s
	client := NewAgentENVClient("http://localhost", WithHTTPClient(custom))
	if client.httpClient != custom {
		t.Error("custom HTTP client not applied")
	}
}

// ---------- ContainerLifecycle tests ----------

func TestContainerLifecycleHappyPath(t *testing.T) {
	// Set up a mock server that responds to create, exec, and destroy.
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/sandboxes":
			json.NewEncoder(w).Encode(CreateSandboxResponse{
				SandboxID:   "sbx-lc",
				ContainerID: "ctr-lc",
				Status:      "created",
			})
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/sandboxes/sbx-lc/exec":
			json.NewEncoder(w).Encode(ExecInSandboxResponse{ExitCode: 0})
		case r.Method == http.MethodDelete:
			w.WriteHeader(http.StatusNoContent)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer ts.Close()

	client := NewAgentENVClient(ts.URL)
	image := DigestPinnedImage{Repository: "test/img", Digest: "sha256:000"}
	lc := NewContainerLifecycle("sbx-lc", client, image, CreateSandboxRequest{})

	// Track transitions.
	var transitions []string
	lc.OnTransition(func(evt ContainerLifecycleEvent) {
		transitions = append(transitions, string(evt.From)+"->"+string(evt.To))
	})

	ctx := context.Background()

	if err := lc.Create(ctx); err != nil {
		t.Fatalf("Create: %v", err)
	}
	if lc.State() != StateCreated {
		t.Errorf("state = %s, want created", lc.State())
	}

	if err := lc.Start(ctx); err != nil {
		t.Fatalf("Start: %v", err)
	}
	if lc.State() != StateReady {
		t.Errorf("state = %s, want ready", lc.State())
	}

	if err := lc.Stop(ctx); err != nil {
		t.Fatalf("Stop: %v", err)
	}
	if lc.State() != StateStopped {
		t.Errorf("state = %s, want stopped", lc.State())
	}

	if err := lc.Destroy(ctx); err != nil {
		t.Fatalf("Destroy: %v", err)
	}
	if lc.State() != StateDestroyed {
		t.Errorf("state = %s, want destroyed", lc.State())
	}

	expectedTransitions := []string{
		"->creating",
		"creating->created",
		"created->starting",
		"starting->ready",
		"ready->stopping",
		"stopping->stopped",
		"stopped->destroyed",
	}
	if len(transitions) != len(expectedTransitions) {
		t.Fatalf("transition count = %d, want %d: %v", len(transitions), len(expectedTransitions), transitions)
	}
	for i, want := range expectedTransitions {
		if transitions[i] != want {
			t.Errorf("transition[%d] = %q, want %q", i, transitions[i], want)
		}
	}
}

func TestContainerLifecycleInvalidTransition(t *testing.T) {
	client := NewAgentENVClient("http://unused")
	image := DigestPinnedImage{Repository: "test/img", Digest: "sha256:000"}
	lc := NewContainerLifecycle("sbx-inv", client, image, CreateSandboxRequest{})

	// Trying to Stop before Create should fail.
	err := lc.Stop(context.Background())
	if err == nil {
		t.Fatal("expected invalid transition error")
	}
}

func TestContainerLifecycleCreateFailure(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
		w.Write([]byte("unavailable"))
	}))
	defer ts.Close()

	client := NewAgentENVClient(ts.URL)
	image := DigestPinnedImage{Repository: "test/img", Digest: "sha256:000"}
	lc := NewContainerLifecycle("sbx-fail", client, image, CreateSandboxRequest{})

	err := lc.Create(context.Background())
	if err == nil {
		t.Fatal("expected create failure")
	}
	if lc.State() != StateFailed {
		t.Errorf("state = %s, want failed", lc.State())
	}
	if lc.LastError() == nil {
		t.Error("expected LastError to be set")
	}
}

func TestContainerLifecycleSnapshot(t *testing.T) {
	client := NewAgentENVClient("http://unused")
	image := DigestPinnedImage{Repository: "test/img", Digest: "sha256:snap"}
	lc := NewContainerLifecycle("sbx-snap", client, image, CreateSandboxRequest{})

	snap := lc.Snapshot()
	if snap.SandboxID != "sbx-snap" {
		t.Errorf("snapshot sandbox_id = %q", snap.SandboxID)
	}
	if snap.Image != "test/img@sha256:snap" {
		t.Errorf("snapshot image = %q", snap.Image)
	}
	if snap.State != StateNone {
		t.Errorf("snapshot state = %q, want empty", snap.State)
	}
}

func TestContainerLifecycleForceDestroy(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodDelete {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		json.NewEncoder(w).Encode(CreateSandboxResponse{SandboxID: "sbx-fd", Status: "created"})
	}))
	defer ts.Close()

	client := NewAgentENVClient(ts.URL)
	image := DigestPinnedImage{Repository: "test/img", Digest: "sha256:fd"}
	lc := NewContainerLifecycle("sbx-fd", client, image, CreateSandboxRequest{})

	if err := lc.Create(context.Background()); err != nil {
		t.Fatalf("Create: %v", err)
	}

	// Force destroy from created state (normally not allowed via Destroy without stop).
	if err := lc.ForceDestroy(context.Background()); err != nil {
		t.Fatalf("ForceDestroy: %v", err)
	}
	if lc.State() != StateDestroyed {
		t.Errorf("state = %s, want destroyed", lc.State())
	}
}

// ---------- State transition validation ----------

func TestValidTransitionsCompleteness(t *testing.T) {
	// Verify that every state mentioned as a target is also a key in the map
	// (except StateDestroyed and StateFailed which are terminal).
	terminal := map[ContainerState]bool{StateDestroyed: true}
	for _, targets := range validTransitions {
		for _, target := range targets {
			if terminal[target] || target == StateFailed {
				continue
			}
			if _, ok := validTransitions[target]; !ok {
				t.Errorf("state %q is a transition target but has no outgoing edges", target)
			}
		}
	}
}
