package builderexec

import (
	"context"
	"fmt"
	"sync"

	"agentic-os/internal/sandbox"
)

// SandboxProvider is the interface that the builder execution layer uses to
// obtain ready-to-use sandbox containers.
type SandboxProvider interface {
	// Acquire provisions and starts a sandbox, returning its ID and a handle
	// to the underlying lifecycle. The caller must call Release when done.
	Acquire(ctx context.Context, req SandboxAcquireRequest) (*SandboxHandle, error)

	// Release stops and destroys the sandbox, returning its resources.
	Release(ctx context.Context, sandboxID string) error

	// Exec runs a command inside an acquired sandbox.
	Exec(ctx context.Context, sandboxID string, req sandbox.ExecInSandboxRequest) (*sandbox.ExecInSandboxResponse, error)

	// ImportArtifact copies a host file into the sandbox with digest verification.
	ImportArtifact(ctx context.Context, sandboxID string, worktreeRoot, hostPath, containerPath string) error

	// ExportArtifact copies a container file to the host with digest verification.
	ExportArtifact(ctx context.Context, sandboxID string, worktreeRoot, containerPath, hostPath string) (string, error)
}

// SandboxAcquireRequest contains parameters for provisioning a sandbox.
type SandboxAcquireRequest struct {
	AttemptID   string
	Image       sandbox.DigestPinnedImage
	WorkDir     string
	Env         map[string]string
	MemoryMB    int
	CPUMillis   int
	TimeoutSecs int
	NetworkMode string
}

// SandboxHandle is returned after a successful Acquire. It holds references
// to the lifecycle and transport for direct access if needed.
type SandboxHandle struct {
	SandboxID string
	Lifecycle *sandbox.ContainerLifecycle
	Transport *sandbox.ArtifactTransport
}

// ---------- AgentENV-backed provider ----------

// AgentENVSandboxProvider implements SandboxProvider by delegating to a real
// AgentENVClient. It manages lifecycles and artifact transport for each sandbox.
type AgentENVSandboxProvider struct {
	mu      sync.Mutex
	client  *sandbox.AgentENVClient
	handles map[string]*SandboxHandle
	counter int
}

// NewAgentENVSandboxProvider creates a provider backed by a real AgentENV client.
func NewAgentENVSandboxProvider(client *sandbox.AgentENVClient) *AgentENVSandboxProvider {
	return &AgentENVSandboxProvider{
		client:  client,
		handles: make(map[string]*SandboxHandle),
	}
}

// Acquire provisions a new sandbox container and moves it through the lifecycle
// to the ready state.
func (p *AgentENVSandboxProvider) Acquire(ctx context.Context, req SandboxAcquireRequest) (*SandboxHandle, error) {
	p.mu.Lock()
	p.counter++
	sandboxID := fmt.Sprintf("sbx-%s-%d", req.AttemptID, p.counter)
	p.mu.Unlock()

	createReq := sandbox.CreateSandboxRequest{
		SandboxID:   sandboxID,
		Image:       req.Image,
		WorkDir:     req.WorkDir,
		Env:         req.Env,
		MemoryMB:    req.MemoryMB,
		CPUMillis:   req.CPUMillis,
		TimeoutSecs: req.TimeoutSecs,
		NetworkMode: req.NetworkMode,
	}

	lc := sandbox.NewContainerLifecycle(sandboxID, p.client, req.Image, createReq)

	if err := lc.Create(ctx); err != nil {
		return nil, fmt.Errorf("acquire/create sandbox %s: %w", sandboxID, err)
	}

	if err := lc.Start(ctx); err != nil {
		// Best-effort destroy on start failure.
		_ = lc.ForceDestroy(ctx)
		return nil, fmt.Errorf("acquire/start sandbox %s: %w", sandboxID, err)
	}

	transport := sandbox.NewArtifactTransport(p.client, sandboxID)

	handle := &SandboxHandle{
		SandboxID: sandboxID,
		Lifecycle: lc,
		Transport: transport,
	}

	p.mu.Lock()
	p.handles[sandboxID] = handle
	p.mu.Unlock()

	return handle, nil
}

// Release stops and destroys a sandbox, removing it from tracking.
func (p *AgentENVSandboxProvider) Release(ctx context.Context, sandboxID string) error {
	p.mu.Lock()
	handle, ok := p.handles[sandboxID]
	if !ok {
		p.mu.Unlock()
		return fmt.Errorf("sandbox %s not found in provider", sandboxID)
	}
	delete(p.handles, sandboxID)
	p.mu.Unlock()

	state := handle.Lifecycle.State()
	if state == sandbox.StateReady {
		if err := handle.Lifecycle.Stop(ctx); err != nil {
			// Fall through to force-destroy.
			_ = handle.Lifecycle.ForceDestroy(ctx)
			return nil
		}
	}

	if err := handle.Lifecycle.Destroy(ctx); err != nil {
		_ = handle.Lifecycle.ForceDestroy(ctx)
	}
	return nil
}

// Exec delegates command execution to the AgentENV client.
func (p *AgentENVSandboxProvider) Exec(ctx context.Context, sandboxID string, req sandbox.ExecInSandboxRequest) (*sandbox.ExecInSandboxResponse, error) {
	req.SandboxID = sandboxID
	return p.client.ExecInSandbox(ctx, req)
}

// ImportArtifact delegates to the ArtifactTransport for the sandbox.
func (p *AgentENVSandboxProvider) ImportArtifact(ctx context.Context, sandboxID string, worktreeRoot, hostPath, containerPath string) error {
	p.mu.Lock()
	handle, ok := p.handles[sandboxID]
	p.mu.Unlock()
	if !ok {
		return fmt.Errorf("sandbox %s not found for import", sandboxID)
	}
	return handle.Transport.ImportFile(ctx, worktreeRoot, hostPath, containerPath)
}

// ExportArtifact delegates to the ArtifactTransport for the sandbox.
func (p *AgentENVSandboxProvider) ExportArtifact(ctx context.Context, sandboxID string, worktreeRoot, containerPath, hostPath string) (string, error) {
	p.mu.Lock()
	handle, ok := p.handles[sandboxID]
	p.mu.Unlock()
	if !ok {
		return "", fmt.Errorf("sandbox %s not found for export", sandboxID)
	}
	return handle.Transport.ExportFile(ctx, worktreeRoot, containerPath, hostPath)
}

// ActiveSandboxes returns the IDs of all currently acquired sandboxes.
func (p *AgentENVSandboxProvider) ActiveSandboxes() []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	ids := make([]string, 0, len(p.handles))
	for id := range p.handles {
		ids = append(ids, id)
	}
	return ids
}

// ReleaseAll force-destroys all active sandboxes. Used during shutdown.
func (p *AgentENVSandboxProvider) ReleaseAll(ctx context.Context) []error {
	p.mu.Lock()
	handles := make(map[string]*SandboxHandle, len(p.handles))
	for k, v := range p.handles {
		handles[k] = v
	}
	p.handles = make(map[string]*SandboxHandle)
	p.mu.Unlock()

	var errs []error
	for _, handle := range handles {
		if err := handle.Lifecycle.ForceDestroy(ctx); err != nil {
			errs = append(errs, err)
		}
	}
	return errs
}
