package builderexec

import (
	"context"
	"fmt"
	"sync"
	"testing"
)

// ---------- mock probes ----------

type mockAttemptProbe struct {
	mu    sync.Mutex
	alive map[string]bool
}

func newMockAttemptProbe() *mockAttemptProbe {
	return &mockAttemptProbe{alive: make(map[string]bool)}
}

func (m *mockAttemptProbe) setAlive(id string, alive bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.alive[id] = alive
}

func (m *mockAttemptProbe) IsAttemptAlive(_ context.Context, id string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	alive, ok := m.alive[id]
	if !ok {
		return false, nil
	}
	return alive, nil
}

type mockPaneProbe struct {
	mu        sync.Mutex
	alive     map[string]bool
	destroyed []string
}

func newMockPaneProbe() *mockPaneProbe {
	return &mockPaneProbe{alive: make(map[string]bool)}
}

func (m *mockPaneProbe) setAlive(id string, alive bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.alive[id] = alive
}

func (m *mockPaneProbe) IsPaneAlive(_ context.Context, id string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	alive, ok := m.alive[id]
	if !ok {
		return false, nil
	}
	return alive, nil
}

func (m *mockPaneProbe) DestroyPane(_ context.Context, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.destroyed = append(m.destroyed, id)
	delete(m.alive, id)
	return nil
}

type mockSandboxProbe struct {
	mu        sync.Mutex
	alive     map[string]bool
	destroyed []string
}

func newMockSandboxProbe() *mockSandboxProbe {
	return &mockSandboxProbe{alive: make(map[string]bool)}
}

func (m *mockSandboxProbe) setAlive(id string, alive bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.alive[id] = alive
}

func (m *mockSandboxProbe) IsSandboxAlive(_ context.Context, id string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	alive, ok := m.alive[id]
	if !ok {
		return false, nil
	}
	return alive, nil
}

func (m *mockSandboxProbe) DestroySandbox(_ context.Context, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.destroyed = append(m.destroyed, id)
	delete(m.alive, id)
	return nil
}

type mockProcessProbe struct {
	mu     sync.Mutex
	alive  map[string]bool
	killed []string
}

func newMockProcessProbe() *mockProcessProbe {
	return &mockProcessProbe{alive: make(map[string]bool)}
}

func (m *mockProcessProbe) setAlive(id string, alive bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.alive[id] = alive
}

func (m *mockProcessProbe) IsProcessAlive(_ context.Context, id string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	alive, ok := m.alive[id]
	if !ok {
		return false, nil
	}
	return alive, nil
}

func (m *mockProcessProbe) KillProcess(_ context.Context, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.killed = append(m.killed, id)
	delete(m.alive, id)
	return nil
}

// ---------- Reconciler tests ----------

func TestReconcilerNoOrphans(t *testing.T) {
	attempts := newMockAttemptProbe()
	panes := newMockPaneProbe()
	sandboxes := newMockSandboxProbe()
	processes := newMockProcessProbe()

	r := NewReconciler(attempts, panes, sandboxes, processes)

	attempts.setAlive("att-1", true)
	panes.setAlive("pane-1", true)
	sandboxes.setAlive("sbx-1", true)
	processes.setAlive("proc-1", true)

	r.Track(ResourcePane, "pane-1", "att-1")
	r.Track(ResourceSandbox, "sbx-1", "att-1")
	r.Track(ResourceProcess, "proc-1", "att-1")

	result := r.Reconcile(context.Background())

	if result.ResourcesChecked != 3 {
		t.Errorf("checked = %d, want 3", result.ResourcesChecked)
	}
	if result.OrphansDetected != 0 {
		t.Errorf("orphans detected = %d, want 0", result.OrphansDetected)
	}
	if result.OrphansCleaned != 0 {
		t.Errorf("orphans cleaned = %d, want 0", result.OrphansCleaned)
	}
}

func TestReconcilerDetectsAndCleansOrphans(t *testing.T) {
	attempts := newMockAttemptProbe()
	panes := newMockPaneProbe()
	sandboxes := newMockSandboxProbe()
	processes := newMockProcessProbe()

	r := NewReconciler(attempts, panes, sandboxes, processes)

	// attempt is dead.
	attempts.setAlive("att-dead", false)
	panes.setAlive("pane-orphan", true)
	sandboxes.setAlive("sbx-orphan", true)
	processes.setAlive("proc-orphan", true)

	r.Track(ResourcePane, "pane-orphan", "att-dead")
	r.Track(ResourceSandbox, "sbx-orphan", "att-dead")
	r.Track(ResourceProcess, "proc-orphan", "att-dead")

	result := r.Reconcile(context.Background())

	if result.OrphansDetected != 3 {
		t.Errorf("orphans detected = %d, want 3", result.OrphansDetected)
	}
	if result.OrphansCleaned != 3 {
		t.Errorf("orphans cleaned = %d, want 3", result.OrphansCleaned)
	}

	// Verify cleanup actions were taken.
	if len(panes.destroyed) != 1 || panes.destroyed[0] != "pane-orphan" {
		t.Errorf("pane not destroyed: %v", panes.destroyed)
	}
	if len(sandboxes.destroyed) != 1 || sandboxes.destroyed[0] != "sbx-orphan" {
		t.Errorf("sandbox not destroyed: %v", sandboxes.destroyed)
	}
	if len(processes.killed) != 1 || processes.killed[0] != "proc-orphan" {
		t.Errorf("process not killed: %v", processes.killed)
	}

	// Orphans should be removed from tracking.
	tracked := r.TrackedResources()
	if len(tracked) != 0 {
		t.Errorf("expected 0 tracked resources after cleanup, got %d", len(tracked))
	}
}

func TestReconcilerMixedAliveAndDead(t *testing.T) {
	attempts := newMockAttemptProbe()
	panes := newMockPaneProbe()
	sandboxes := newMockSandboxProbe()
	processes := newMockProcessProbe()

	r := NewReconciler(attempts, panes, sandboxes, processes)

	attempts.setAlive("att-alive", true)
	attempts.setAlive("att-dead", false)
	panes.setAlive("pane-ok", true)
	sandboxes.setAlive("sbx-orphan", true)

	r.Track(ResourcePane, "pane-ok", "att-alive")
	r.Track(ResourceSandbox, "sbx-orphan", "att-dead")

	result := r.Reconcile(context.Background())

	if result.OrphansDetected != 1 {
		t.Errorf("orphans detected = %d, want 1", result.OrphansDetected)
	}
	if result.OrphansCleaned != 1 {
		t.Errorf("orphans cleaned = %d, want 1", result.OrphansCleaned)
	}

	// pane-ok should still be tracked.
	tracked := r.TrackedResources()
	if len(tracked) != 1 {
		t.Fatalf("expected 1 tracked resource, got %d", len(tracked))
	}
	if tracked[0].ID != "pane-ok" {
		t.Errorf("remaining resource = %s, want pane-ok", tracked[0].ID)
	}
}

func TestReconcilerUntrack(t *testing.T) {
	attempts := newMockAttemptProbe()
	r := NewReconciler(attempts, newMockPaneProbe(), newMockSandboxProbe(), newMockProcessProbe())

	r.Track(ResourceSandbox, "sbx-1", "att-1")
	r.Untrack(ResourceSandbox, "sbx-1")

	tracked := r.TrackedResources()
	if len(tracked) != 0 {
		t.Errorf("expected 0 tracked resources after untrack, got %d", len(tracked))
	}
}

func TestReconcilerLastResult(t *testing.T) {
	r := NewReconciler(newMockAttemptProbe(), newMockPaneProbe(), newMockSandboxProbe(), newMockProcessProbe())

	if r.LastResult() != nil {
		t.Error("expected nil LastResult before any reconciliation")
	}

	r.Reconcile(context.Background())

	lr := r.LastResult()
	if lr == nil {
		t.Fatal("expected non-nil LastResult after reconciliation")
	}
	if lr.ResourcesChecked != 0 {
		t.Errorf("checked = %d, want 0", lr.ResourcesChecked)
	}
}

// ---------- error probe ----------

type errorAttemptProbe struct{}

func (e *errorAttemptProbe) IsAttemptAlive(_ context.Context, _ string) (bool, error) {
	return false, fmt.Errorf("probe failure")
}

func TestReconcilerProbeError(t *testing.T) {
	r := NewReconciler(&errorAttemptProbe{}, newMockPaneProbe(), newMockSandboxProbe(), newMockProcessProbe())

	r.Track(ResourceSandbox, "sbx-1", "att-1")
	result := r.Reconcile(context.Background())

	if len(result.Errors) == 0 {
		t.Error("expected errors from probe failure")
	}
	// When the attempt probe errors, we cannot determine orphan status,
	// so no orphans should be detected.
	if result.OrphansDetected != 0 {
		t.Errorf("orphans detected = %d, want 0 (probe errored)", result.OrphansDetected)
	}
}

func TestResourceKeyUniqueness(t *testing.T) {
	k1 := resourceKey(ResourcePane, "id-1")
	k2 := resourceKey(ResourceSandbox, "id-1")
	if k1 == k2 {
		t.Error("keys for different kinds with same ID should differ")
	}
}
