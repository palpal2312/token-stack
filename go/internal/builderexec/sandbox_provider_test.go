package builderexec

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"agentic-os/internal/sandbox"
)

func TestAgentENVSandboxProviderAcquireRelease(t *testing.T) {
	// Mock AgentENV server that handles create, exec (health probe), stop-exec, and destroy.
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/sandboxes":
			var req sandbox.CreateSandboxRequest
			json.NewDecoder(r.Body).Decode(&req)
			json.NewEncoder(w).Encode(sandbox.CreateSandboxResponse{
				SandboxID:   req.SandboxID,
				ContainerID: "ctr-" + req.SandboxID,
				Status:      "created",
			})
		case r.Method == http.MethodPost && containsSuffix(r.URL.Path, "/exec"):
			json.NewEncoder(w).Encode(sandbox.ExecInSandboxResponse{ExitCode: 0})
		case r.Method == http.MethodDelete:
			w.WriteHeader(http.StatusNoContent)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer ts.Close()

	client := sandbox.NewAgentENVClient(ts.URL)
	provider := NewAgentENVSandboxProvider(client)

	ctx := context.Background()

	handle, err := provider.Acquire(ctx, SandboxAcquireRequest{
		AttemptID: "att-1",
		Image: sandbox.DigestPinnedImage{
			Repository: "test/img",
			Digest:     "sha256:abc",
		},
		MemoryMB:    512,
		NetworkMode: "none",
	})
	if err != nil {
		t.Fatalf("Acquire: %v", err)
	}
	if handle.SandboxID == "" {
		t.Error("expected non-empty sandbox ID")
	}
	if handle.Lifecycle == nil {
		t.Error("expected non-nil lifecycle")
	}
	if handle.Transport == nil {
		t.Error("expected non-nil transport")
	}

	// Should be in the active list.
	active := provider.ActiveSandboxes()
	if len(active) != 1 {
		t.Fatalf("active sandboxes = %d, want 1", len(active))
	}

	// Release.
	if err := provider.Release(ctx, handle.SandboxID); err != nil {
		t.Fatalf("Release: %v", err)
	}

	active = provider.ActiveSandboxes()
	if len(active) != 0 {
		t.Errorf("active sandboxes after release = %d, want 0", len(active))
	}
}

func TestAgentENVSandboxProviderReleaseNotFound(t *testing.T) {
	client := sandbox.NewAgentENVClient("http://unused")
	provider := NewAgentENVSandboxProvider(client)

	err := provider.Release(context.Background(), "nonexistent")
	if err == nil {
		t.Error("expected error when releasing unknown sandbox")
	}
}

func TestAgentENVSandboxProviderExecDelegation(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/sandboxes":
			json.NewEncoder(w).Encode(sandbox.CreateSandboxResponse{SandboxID: "sbx-exec", Status: "created"})
		case r.Method == http.MethodPost && containsSuffix(r.URL.Path, "/exec"):
			json.NewEncoder(w).Encode(sandbox.ExecInSandboxResponse{
				ExitCode: 42,
				Stdout:   "test output",
			})
		case r.Method == http.MethodDelete:
			w.WriteHeader(http.StatusNoContent)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer ts.Close()

	client := sandbox.NewAgentENVClient(ts.URL)
	provider := NewAgentENVSandboxProvider(client)
	ctx := context.Background()

	handle, err := provider.Acquire(ctx, SandboxAcquireRequest{
		AttemptID: "att-exec",
		Image:     sandbox.DigestPinnedImage{Repository: "test/img", Digest: "sha256:exec"},
	})
	if err != nil {
		t.Fatalf("Acquire: %v", err)
	}

	resp, err := provider.Exec(ctx, handle.SandboxID, sandbox.ExecInSandboxRequest{
		Command: []string{"ls", "-la"},
	})
	if err != nil {
		t.Fatalf("Exec: %v", err)
	}
	if resp.ExitCode != 42 {
		t.Errorf("exit code = %d, want 42", resp.ExitCode)
	}
	if resp.Stdout != "test output" {
		t.Errorf("stdout = %q, want 'test output'", resp.Stdout)
	}

	_ = provider.Release(ctx, handle.SandboxID)
}

func TestAgentENVSandboxProviderReleaseAll(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/sandboxes":
			json.NewEncoder(w).Encode(sandbox.CreateSandboxResponse{SandboxID: "sbx-all", Status: "created"})
		case r.Method == http.MethodPost && containsSuffix(r.URL.Path, "/exec"):
			json.NewEncoder(w).Encode(sandbox.ExecInSandboxResponse{ExitCode: 0})
		case r.Method == http.MethodDelete:
			w.WriteHeader(http.StatusNoContent)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer ts.Close()

	client := sandbox.NewAgentENVClient(ts.URL)
	provider := NewAgentENVSandboxProvider(client)
	ctx := context.Background()

	for i := 0; i < 3; i++ {
		_, err := provider.Acquire(ctx, SandboxAcquireRequest{
			AttemptID: "att-all",
			Image:     sandbox.DigestPinnedImage{Repository: "test/img", Digest: "sha256:all"},
		})
		if err != nil {
			t.Fatalf("Acquire %d: %v", i, err)
		}
	}

	if len(provider.ActiveSandboxes()) != 3 {
		t.Fatalf("expected 3 active sandboxes")
	}

	errs := provider.ReleaseAll(ctx)
	if len(errs) != 0 {
		t.Errorf("ReleaseAll errors: %v", errs)
	}

	if len(provider.ActiveSandboxes()) != 0 {
		t.Error("expected 0 active sandboxes after ReleaseAll")
	}
}

func TestAgentENVSandboxProviderImportExportNotFound(t *testing.T) {
	client := sandbox.NewAgentENVClient("http://unused")
	provider := NewAgentENVSandboxProvider(client)
	ctx := context.Background()

	err := provider.ImportArtifact(ctx, "nonexistent", "/root", "/host/file", "/container/file")
	if err == nil {
		t.Error("expected error for import on unknown sandbox")
	}

	_, err = provider.ExportArtifact(ctx, "nonexistent", "/root", "/container/file", "/host/file")
	if err == nil {
		t.Error("expected error for export on unknown sandbox")
	}
}

// containsSuffix checks if a string ends with a suffix (helper for URL matching).
func containsSuffix(s, suffix string) bool {
	return len(s) >= len(suffix) && s[len(s)-len(suffix):] == suffix
}
