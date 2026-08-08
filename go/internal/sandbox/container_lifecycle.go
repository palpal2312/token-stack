package sandbox

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// ContainerState represents the current phase of the container lifecycle.
type ContainerState string

const (
	StateNone      ContainerState = ""
	StateCreating  ContainerState = "creating"
	StateCreated   ContainerState = "created"
	StateStarting  ContainerState = "starting"
	StateReady     ContainerState = "ready"
	StateStopping  ContainerState = "stopping"
	StateStopped   ContainerState = "stopped"
	StateDestroyed ContainerState = "destroyed"
	StateFailed    ContainerState = "failed"
)

// validTransitions defines the allowed state machine edges:
//
//	(none) -> creating -> created -> starting -> ready -> stopping -> stopped -> destroyed
//
// Any state may transition to "failed".
var validTransitions = map[ContainerState][]ContainerState{
	StateNone:     {StateCreating},
	StateCreating: {StateCreated, StateFailed},
	StateCreated:  {StateStarting, StateDestroyed, StateFailed},
	StateStarting: {StateReady, StateFailed},
	StateReady:    {StateStopping, StateFailed},
	StateStopping: {StateStopped, StateFailed},
	StateStopped:  {StateDestroyed, StateFailed},
	StateFailed:   {StateDestroyed},
}

// ContainerLifecycleEvent is emitted whenever the container changes state.
type ContainerLifecycleEvent struct {
	SandboxID string
	From      ContainerState
	To        ContainerState
	Timestamp time.Time
	Error     error // non-nil when transitioning to StateFailed
}

// LifecycleObserver is notified on every state transition.
type LifecycleObserver func(ContainerLifecycleEvent)

// ContainerLifecycle manages the create -> start -> ready -> stop -> destroy
// state machine for a single sandbox container. All methods are safe for
// concurrent use.
type ContainerLifecycle struct {
	mu        sync.Mutex
	sandboxID string
	state     ContainerState
	client    *AgentENVClient
	image     DigestPinnedImage
	config    CreateSandboxRequest
	observers []LifecycleObserver
	lastErr   error
	createdAt time.Time
	readyAt   time.Time
	stoppedAt time.Time
}

// NewContainerLifecycle builds a lifecycle manager for the given sandbox.
func NewContainerLifecycle(
	sandboxID string,
	client *AgentENVClient,
	image DigestPinnedImage,
	config CreateSandboxRequest,
) *ContainerLifecycle {
	config.SandboxID = sandboxID
	config.Image = image
	return &ContainerLifecycle{
		sandboxID: sandboxID,
		state:     StateNone,
		client:    client,
		image:     image,
		config:    config,
	}
}

// OnTransition registers an observer that is called synchronously on every
// state change. Must be called before any lifecycle method.
func (cl *ContainerLifecycle) OnTransition(obs LifecycleObserver) {
	cl.mu.Lock()
	defer cl.mu.Unlock()
	cl.observers = append(cl.observers, obs)
}

// State returns the current lifecycle state.
func (cl *ContainerLifecycle) State() ContainerState {
	cl.mu.Lock()
	defer cl.mu.Unlock()
	return cl.state
}

// LastError returns the error that caused a transition to StateFailed, or nil.
func (cl *ContainerLifecycle) LastError() error {
	cl.mu.Lock()
	defer cl.mu.Unlock()
	return cl.lastErr
}

// Create provisions the container (state: none -> creating -> created).
func (cl *ContainerLifecycle) Create(ctx context.Context) error {
	cl.mu.Lock()
	if err := cl.transitionLocked(StateCreating, nil); err != nil {
		cl.mu.Unlock()
		return err
	}
	cl.mu.Unlock()

	_, err := cl.client.CreateSandbox(ctx, cl.config)

	cl.mu.Lock()
	defer cl.mu.Unlock()
	if err != nil {
		_ = cl.transitionLocked(StateFailed, err)
		return fmt.Errorf("container create: %w", err)
	}
	cl.createdAt = time.Now()
	return cl.transitionLocked(StateCreated, nil)
}

// Start moves the container from created to ready (created -> starting -> ready).
// In the AgentENV model, start is implicit in create, so this performs a health
// probe via exec.
func (cl *ContainerLifecycle) Start(ctx context.Context) error {
	cl.mu.Lock()
	if err := cl.transitionLocked(StateStarting, nil); err != nil {
		cl.mu.Unlock()
		return err
	}
	cl.mu.Unlock()

	// Health probe: run a trivial command to confirm the container is responsive.
	_, err := cl.client.ExecInSandbox(ctx, ExecInSandboxRequest{
		SandboxID:  cl.sandboxID,
		Command:    []string{"true"},
		TimeoutSec: 10,
	})

	cl.mu.Lock()
	defer cl.mu.Unlock()
	if err != nil {
		_ = cl.transitionLocked(StateFailed, err)
		return fmt.Errorf("container health probe: %w", err)
	}
	cl.readyAt = time.Now()
	return cl.transitionLocked(StateReady, nil)
}

// Stop gracefully halts the container (ready -> stopping -> stopped).
func (cl *ContainerLifecycle) Stop(ctx context.Context) error {
	cl.mu.Lock()
	if err := cl.transitionLocked(StateStopping, nil); err != nil {
		cl.mu.Unlock()
		return err
	}
	cl.mu.Unlock()

	// Send a SIGTERM-equivalent via exec; ignore errors because the container
	// may already be exiting.
	_, _ = cl.client.ExecInSandbox(ctx, ExecInSandboxRequest{
		SandboxID:  cl.sandboxID,
		Command:    []string{"kill", "-TERM", "1"},
		TimeoutSec: 5,
	})

	cl.mu.Lock()
	defer cl.mu.Unlock()
	cl.stoppedAt = time.Now()
	return cl.transitionLocked(StateStopped, nil)
}

// Destroy tears down the container and frees resources (stopped|created|failed -> destroyed).
func (cl *ContainerLifecycle) Destroy(ctx context.Context) error {
	cl.mu.Lock()
	if err := cl.transitionLocked(StateDestroyed, nil); err != nil {
		cl.mu.Unlock()
		return err
	}
	cl.mu.Unlock()

	err := cl.client.DestroySandbox(ctx, DestroySandboxRequest{
		SandboxID: cl.sandboxID,
		Force:     true,
	})
	if err != nil {
		return fmt.Errorf("container destroy: %w", err)
	}
	return nil
}

// ForceDestroy moves to destroyed regardless of current state, then calls
// the API with force=true. Used for orphan cleanup.
func (cl *ContainerLifecycle) ForceDestroy(ctx context.Context) error {
	cl.mu.Lock()
	// Force the state so we can call destroy from any state.
	from := cl.state
	cl.state = StateDestroyed
	cl.emit(ContainerLifecycleEvent{
		SandboxID: cl.sandboxID,
		From:      from,
		To:        StateDestroyed,
		Timestamp: time.Now(),
	})
	cl.mu.Unlock()

	return cl.client.DestroySandbox(ctx, DestroySandboxRequest{
		SandboxID: cl.sandboxID,
		Force:     true,
	})
}

// Snapshot returns a read-only summary of the lifecycle.
func (cl *ContainerLifecycle) Snapshot() ContainerLifecycleSnapshot {
	cl.mu.Lock()
	defer cl.mu.Unlock()
	var errMsg string
	if cl.lastErr != nil {
		errMsg = cl.lastErr.Error()
	}
	return ContainerLifecycleSnapshot{
		SandboxID: cl.sandboxID,
		State:     cl.state,
		Image:     cl.image.Reference(),
		Error:     errMsg,
		CreatedAt: cl.createdAt,
		ReadyAt:   cl.readyAt,
		StoppedAt: cl.stoppedAt,
	}
}

// ContainerLifecycleSnapshot is a serializable point-in-time view.
type ContainerLifecycleSnapshot struct {
	SandboxID string         `json:"sandbox_id"`
	State     ContainerState `json:"state"`
	Image     string         `json:"image"`
	Error     string         `json:"error,omitempty"`
	CreatedAt time.Time      `json:"created_at,omitempty"`
	ReadyAt   time.Time      `json:"ready_at,omitempty"`
	StoppedAt time.Time      `json:"stopped_at,omitempty"`
}

// ---------- internal ----------

func (cl *ContainerLifecycle) transitionLocked(to ContainerState, err error) error {
	allowed := validTransitions[cl.state]
	ok := false
	for _, s := range allowed {
		if s == to {
			ok = true
			break
		}
	}
	if !ok {
		return fmt.Errorf("invalid container state transition %q -> %q for sandbox %s",
			cl.state, to, cl.sandboxID)
	}

	from := cl.state
	cl.state = to
	if err != nil {
		cl.lastErr = err
	}
	cl.emit(ContainerLifecycleEvent{
		SandboxID: cl.sandboxID,
		From:      from,
		To:        to,
		Timestamp: time.Now(),
		Error:     err,
	})
	return nil
}

func (cl *ContainerLifecycle) emit(evt ContainerLifecycleEvent) {
	for _, obs := range cl.observers {
		obs(evt)
	}
}
