// Package builderexec provides the 4-way lifecycle reconciler and sandbox
// provider wiring for the builder execution subsystem.
package builderexec

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// ---------- resource kind enums ----------

// ResourceKind identifies the type of resource being tracked.
type ResourceKind string

const (
	ResourceAttempt ResourceKind = "attempt"
	ResourcePane    ResourceKind = "pane"
	ResourceSandbox ResourceKind = "sandbox"
	ResourceProcess ResourceKind = "process"
)

// ResourceState is the observed liveness state of a tracked resource.
type ResourceState string

const (
	ResourceAlive   ResourceState = "alive"
	ResourceStopped ResourceState = "stopped"
	ResourceUnknown ResourceState = "unknown"
	ResourceOrphan  ResourceState = "orphan"
)

// ---------- tracked resource ----------

// TrackedResource represents one of the four managed resource types with its
// current observed state and the owning attempt ID.
type TrackedResource struct {
	Kind      ResourceKind  `json:"kind"`
	ID        string        `json:"id"`
	AttemptID string        `json:"attempt_id"`
	State     ResourceState `json:"state"`
	UpdatedAt time.Time     `json:"updated_at"`
	Error     string        `json:"error,omitempty"`
}

// ---------- reconcile result ----------

// ReconcileResult summarizes what the reconciler found and did.
type ReconcileResult struct {
	Timestamp       time.Time          `json:"timestamp"`
	ResourcesChecked int               `json:"resources_checked"`
	OrphansDetected  int               `json:"orphans_detected"`
	OrphansCleaned   int               `json:"orphans_cleaned"`
	Errors           []ReconcileError   `json:"errors,omitempty"`
	Actions          []ReconcileAction  `json:"actions,omitempty"`
}

// ReconcileError records a single error during reconciliation.
type ReconcileError struct {
	ResourceKind ResourceKind `json:"resource_kind"`
	ResourceID   string       `json:"resource_id"`
	Message      string       `json:"message"`
}

// ReconcileAction records a corrective action taken by the reconciler.
type ReconcileAction struct {
	ResourceKind ResourceKind `json:"resource_kind"`
	ResourceID   string       `json:"resource_id"`
	Action       string       `json:"action"` // "destroy" | "kill" | "cleanup"
	Success      bool         `json:"success"`
}

// ---------- probes ----------

// AttemptProbe checks whether an attempt is still active.
type AttemptProbe interface {
	IsAttemptAlive(ctx context.Context, attemptID string) (bool, error)
}

// PaneProbe checks whether a terminal pane is still open.
type PaneProbe interface {
	IsPaneAlive(ctx context.Context, paneID string) (bool, error)
	DestroyPane(ctx context.Context, paneID string) error
}

// SandboxProbe checks sandbox container liveness and can destroy orphans.
type SandboxProbe interface {
	IsSandboxAlive(ctx context.Context, sandboxID string) (bool, error)
	DestroySandbox(ctx context.Context, sandboxID string) error
}

// ProcessProbe checks whether a builder process is still running.
type ProcessProbe interface {
	IsProcessAlive(ctx context.Context, processID string) (bool, error)
	KillProcess(ctx context.Context, processID string) error
}

// ---------- reconciler ----------

// Reconciler implements the 4-way lifecycle reconciler that detects orphaned
// resources (Attempt x Pane x Sandbox x Process) and cleans them up. It runs
// as a periodic loop or can be triggered on-demand.
type Reconciler struct {
	mu        sync.Mutex
	resources map[string]*TrackedResource // key = kind:id

	attemptProbe AttemptProbe
	paneProbe    PaneProbe
	sandboxProbe SandboxProbe
	processProbe ProcessProbe

	lastResult *ReconcileResult
}

// NewReconciler creates a reconciler wired to the four resource probes.
func NewReconciler(
	attempts AttemptProbe,
	panes PaneProbe,
	sandboxes SandboxProbe,
	processes ProcessProbe,
) *Reconciler {
	return &Reconciler{
		resources:    make(map[string]*TrackedResource),
		attemptProbe: attempts,
		paneProbe:    panes,
		sandboxProbe: sandboxes,
		processProbe: processes,
	}
}

// Track registers a resource under the reconciler's supervision.
func (r *Reconciler) Track(kind ResourceKind, id, attemptID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	key := resourceKey(kind, id)
	r.resources[key] = &TrackedResource{
		Kind:      kind,
		ID:        id,
		AttemptID: attemptID,
		State:     ResourceAlive,
		UpdatedAt: time.Now(),
	}
}

// Untrack removes a resource from reconciler supervision.
func (r *Reconciler) Untrack(kind ResourceKind, id string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.resources, resourceKey(kind, id))
}

// Reconcile performs a single reconciliation pass. It probes every tracked
// resource, detects orphans (resources whose owning attempt is dead), and
// cleans them up.
func (r *Reconciler) Reconcile(ctx context.Context) ReconcileResult {
	r.mu.Lock()
	// Snapshot the current resources under the lock.
	snapshot := make([]*TrackedResource, 0, len(r.resources))
	for _, res := range r.resources {
		cp := *res
		snapshot = append(snapshot, &cp)
	}
	r.mu.Unlock()

	result := ReconcileResult{
		Timestamp:        time.Now(),
		ResourcesChecked: len(snapshot),
	}

	// Phase 1: probe each resource for liveness and detect orphans.
	deadAttempts := make(map[string]bool)
	for _, res := range snapshot {
		// Check if the owning attempt is dead (with caching).
		if _, checked := deadAttempts[res.AttemptID]; !checked {
			alive, err := r.attemptProbe.IsAttemptAlive(ctx, res.AttemptID)
			if err != nil {
				result.Errors = append(result.Errors, ReconcileError{
					ResourceKind: ResourceAttempt,
					ResourceID:   res.AttemptID,
					Message:      err.Error(),
				})
				continue
			}
			deadAttempts[res.AttemptID] = !alive
		}

		if deadAttempts[res.AttemptID] {
			res.State = ResourceOrphan
			result.OrphansDetected++
		} else {
			// Attempt alive, probe the resource itself.
			alive, err := r.probeResource(ctx, res.Kind, res.ID)
			if err != nil {
				result.Errors = append(result.Errors, ReconcileError{
					ResourceKind: res.Kind,
					ResourceID:   res.ID,
					Message:      err.Error(),
				})
				res.State = ResourceUnknown
			} else if !alive {
				res.State = ResourceStopped
			} else {
				res.State = ResourceAlive
			}
		}
	}

	// Phase 2: clean up orphans.
	for _, res := range snapshot {
		if res.State != ResourceOrphan {
			continue
		}
		action := ReconcileAction{
			ResourceKind: res.Kind,
			ResourceID:   res.ID,
		}
		var cleanupErr error
		switch res.Kind {
		case ResourcePane:
			action.Action = "destroy"
			cleanupErr = r.paneProbe.DestroyPane(ctx, res.ID)
		case ResourceSandbox:
			action.Action = "destroy"
			cleanupErr = r.sandboxProbe.DestroySandbox(ctx, res.ID)
		case ResourceProcess:
			action.Action = "kill"
			cleanupErr = r.processProbe.KillProcess(ctx, res.ID)
		case ResourceAttempt:
			action.Action = "cleanup"
			// Attempts self-clean; no external action needed.
		}

		if cleanupErr != nil {
			action.Success = false
			result.Errors = append(result.Errors, ReconcileError{
				ResourceKind: res.Kind,
				ResourceID:   res.ID,
				Message:      fmt.Sprintf("cleanup failed: %v", cleanupErr),
			})
		} else {
			action.Success = true
			result.OrphansCleaned++
		}
		result.Actions = append(result.Actions, action)

		// Remove from tracking if cleanup succeeded.
		if action.Success {
			r.mu.Lock()
			delete(r.resources, resourceKey(res.Kind, res.ID))
			r.mu.Unlock()
		}
	}

	// Phase 3: update remaining resource states.
	r.mu.Lock()
	for _, res := range snapshot {
		key := resourceKey(res.Kind, res.ID)
		if tracked, ok := r.resources[key]; ok {
			tracked.State = res.State
			tracked.UpdatedAt = time.Now()
		}
	}
	r.lastResult = &result
	r.mu.Unlock()

	return result
}

// LastResult returns the result of the most recent reconciliation pass.
func (r *Reconciler) LastResult() *ReconcileResult {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.lastResult == nil {
		return nil
	}
	cp := *r.lastResult
	return &cp
}

// TrackedResources returns a snapshot of all tracked resources.
func (r *Reconciler) TrackedResources() []TrackedResource {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]TrackedResource, 0, len(r.resources))
	for _, res := range r.resources {
		out = append(out, *res)
	}
	return out
}

// RunLoop starts a blocking reconciliation loop that runs every interval until
// the context is cancelled.
func (r *Reconciler) RunLoop(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			r.Reconcile(ctx)
		}
	}
}

// ---------- internal ----------

func (r *Reconciler) probeResource(ctx context.Context, kind ResourceKind, id string) (bool, error) {
	switch kind {
	case ResourcePane:
		return r.paneProbe.IsPaneAlive(ctx, id)
	case ResourceSandbox:
		return r.sandboxProbe.IsSandboxAlive(ctx, id)
	case ResourceProcess:
		return r.processProbe.IsProcessAlive(ctx, id)
	case ResourceAttempt:
		return r.attemptProbe.IsAttemptAlive(ctx, id)
	default:
		return false, fmt.Errorf("unknown resource kind: %s", kind)
	}
}

func resourceKey(kind ResourceKind, id string) string {
	return string(kind) + ":" + id
}
