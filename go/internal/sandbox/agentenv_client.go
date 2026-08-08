// Package sandbox provides an HTTP/API client for the AgentENV container
// runtime and artifact transport with SHA-256 digest verification.
package sandbox

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// ---------- digest-pinned image references ----------

// DigestPinnedImage represents a container image reference that is pinned by
// SHA-256 digest rather than a mutable tag, ensuring reproducible builds.
type DigestPinnedImage struct {
	Repository string `json:"repository"` // e.g. "ghcr.io/agent-os/sandbox-runtime"
	Digest     string `json:"digest"`     // e.g. "sha256:abcdef1234..."
}

// Reference returns the canonical image@digest string used by container runtimes.
func (d DigestPinnedImage) Reference() string {
	return fmt.Sprintf("%s@%s", d.Repository, d.Digest)
}

// ---------- request / response types ----------

// CreateSandboxRequest describes the parameters for creating a new sandbox
// container via the AgentENV API.
type CreateSandboxRequest struct {
	SandboxID   string            `json:"sandbox_id"`
	Image       DigestPinnedImage `json:"image"`
	WorkDir     string            `json:"work_dir,omitempty"`
	Env         map[string]string `json:"env,omitempty"`
	MemoryMB    int               `json:"memory_mb,omitempty"`
	CPUMillis   int               `json:"cpu_millis,omitempty"`
	TimeoutSecs int               `json:"timeout_secs,omitempty"`
	NetworkMode string            `json:"network_mode,omitempty"` // "none" | "host" | "bridge"
}

// CreateSandboxResponse is returned after a sandbox is created.
type CreateSandboxResponse struct {
	SandboxID   string `json:"sandbox_id"`
	ContainerID string `json:"container_id"`
	Status      string `json:"status"`
	CreatedAt   string `json:"created_at"`
}

// DestroySandboxRequest identifies which sandbox to tear down.
type DestroySandboxRequest struct {
	SandboxID string `json:"sandbox_id"`
	Force     bool   `json:"force,omitempty"`
}

// ExecInSandboxRequest describes a command execution inside a running sandbox.
type ExecInSandboxRequest struct {
	SandboxID  string   `json:"sandbox_id"`
	Command    []string `json:"command"`
	WorkDir    string   `json:"work_dir,omitempty"`
	Env        []string `json:"env,omitempty"`
	TimeoutSec int      `json:"timeout_sec,omitempty"`
	Stdin      []byte   `json:"stdin,omitempty"`
}

// ExecInSandboxResponse carries the result of an in-sandbox execution.
type ExecInSandboxResponse struct {
	ExitCode int    `json:"exit_code"`
	Stdout   string `json:"stdout"`
	Stderr   string `json:"stderr"`
	TimedOut bool   `json:"timed_out"`
}

// ImportArtifactRequest describes a file to be imported into a sandbox.
type ImportArtifactRequest struct {
	SandboxID     string `json:"sandbox_id"`
	HostPath      string `json:"host_path"`
	ContainerPath string `json:"container_path"`
	SHA256Digest  string `json:"sha256_digest"`
}

// ExportArtifactRequest describes a file to be exported from a sandbox.
type ExportArtifactRequest struct {
	SandboxID     string `json:"sandbox_id"`
	ContainerPath string `json:"container_path"`
	HostPath      string `json:"host_path"`
}

// ExportArtifactResponse carries the result of an artifact export, including
// the computed digest for verification.
type ExportArtifactResponse struct {
	HostPath     string `json:"host_path"`
	SHA256Digest string `json:"sha256_digest"`
	SizeBytes    int64  `json:"size_bytes"`
}

// ---------- client ----------

// AgentENVClient is an HTTP client for the AgentENV sandbox API. It talks to
// the AgentENV daemon over a REST interface.
type AgentENVClient struct {
	baseURL    string
	httpClient *http.Client
	authToken  string
}

// AgentENVClientOption is a functional option for configuring the client.
type AgentENVClientOption func(*AgentENVClient)

// WithHTTPClient overrides the default http.Client.
func WithHTTPClient(c *http.Client) AgentENVClientOption {
	return func(a *AgentENVClient) { a.httpClient = c }
}

// WithAuthToken sets a bearer token for API authentication.
func WithAuthToken(token string) AgentENVClientOption {
	return func(a *AgentENVClient) { a.authToken = token }
}

// NewAgentENVClient creates an AgentENV API client pointed at baseURL.
func NewAgentENVClient(baseURL string, opts ...AgentENVClientOption) *AgentENVClient {
	c := &AgentENVClient{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
	for _, opt := range opts {
		opt(c)
	}
	return c
}

// CreateSandbox provisions a new container sandbox.
func (c *AgentENVClient) CreateSandbox(ctx context.Context, req CreateSandboxRequest) (*CreateSandboxResponse, error) {
	var resp CreateSandboxResponse
	if err := c.doJSON(ctx, http.MethodPost, "/api/v1/sandboxes", req, &resp); err != nil {
		return nil, fmt.Errorf("CreateSandbox: %w", err)
	}
	return &resp, nil
}

// DestroySandbox tears down a sandbox container and reclaims its resources.
func (c *AgentENVClient) DestroySandbox(ctx context.Context, req DestroySandboxRequest) error {
	if err := c.doJSON(ctx, http.MethodDelete, "/api/v1/sandboxes/"+req.SandboxID, req, nil); err != nil {
		return fmt.Errorf("DestroySandbox: %w", err)
	}
	return nil
}

// ExecInSandbox runs a command inside an existing sandbox and returns the
// captured output.
func (c *AgentENVClient) ExecInSandbox(ctx context.Context, req ExecInSandboxRequest) (*ExecInSandboxResponse, error) {
	var resp ExecInSandboxResponse
	if err := c.doJSON(ctx, http.MethodPost, "/api/v1/sandboxes/"+req.SandboxID+"/exec", req, &resp); err != nil {
		return nil, fmt.Errorf("ExecInSandbox: %w", err)
	}
	return &resp, nil
}

// ImportArtifact copies a host-side file into the sandbox, verifying its
// SHA-256 digest before accepting it.
func (c *AgentENVClient) ImportArtifact(ctx context.Context, req ImportArtifactRequest) error {
	if err := c.doJSON(ctx, http.MethodPost, "/api/v1/sandboxes/"+req.SandboxID+"/artifacts/import", req, nil); err != nil {
		return fmt.Errorf("ImportArtifact: %w", err)
	}
	return nil
}

// ExportArtifact copies a file out of the sandbox to the host filesystem and
// returns its digest for downstream verification.
func (c *AgentENVClient) ExportArtifact(ctx context.Context, req ExportArtifactRequest) (*ExportArtifactResponse, error) {
	var resp ExportArtifactResponse
	if err := c.doJSON(ctx, http.MethodPost, "/api/v1/sandboxes/"+req.SandboxID+"/artifacts/export", req, &resp); err != nil {
		return nil, fmt.Errorf("ExportArtifact: %w", err)
	}
	return &resp, nil
}

// ---------- internal helpers ----------

func (c *AgentENVClient) doJSON(ctx context.Context, method, path string, body interface{}, out interface{}) error {
	var bodyReader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("marshal request: %w", err)
		}
		bodyReader = bytes.NewReader(data)
	}

	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, bodyReader)
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	if c.authToken != "" {
		req.Header.Set("Authorization", "Bearer "+c.authToken)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("http request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return &AgentENVAPIError{
			StatusCode: resp.StatusCode,
			Body:       string(respBody),
		}
	}

	if out != nil && len(respBody) > 0 {
		if err := json.Unmarshal(respBody, out); err != nil {
			return fmt.Errorf("unmarshal response: %w", err)
		}
	}
	return nil
}

// AgentENVAPIError represents a non-2xx response from the AgentENV API.
type AgentENVAPIError struct {
	StatusCode int
	Body       string
}

func (e *AgentENVAPIError) Error() string {
	return fmt.Sprintf("agentenv api error (status %d): %s", e.StatusCode, e.Body)
}
