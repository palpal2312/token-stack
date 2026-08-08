# Session 112 -- Phase 08 Steps 11-17: AgentENV Container Realization

**Date:** 2026-08-08
**Phase:** 08 -- Container Runtime & Builder Execution
**Steps:** 11-17 (AgentENV container realization)
**Status:** Complete

---

## Objective

Implement the Go-side container runtime subsystem for Agent OS: a fully typed
AgentENV API client, a state-machine-driven container lifecycle manager, digest-
verified artifact transport, a 4-way orphan reconciler, and a sandbox provider
that wires everything together for the builder execution layer. Complement these
with the committing dispatch scheduler and live scoring allocator.

---

## Deliverables

### Source files (7)

| File | Package | Purpose |
|------|---------|---------|
| `go/internal/sandbox/agentenv_client.go` | sandbox | HTTP client for the AgentENV daemon REST API (create, destroy, exec, import/export artifacts) with bearer-token auth, functional options, and typed error handling |
| `go/internal/sandbox/container_lifecycle.go` | sandbox | Finite-state-machine lifecycle manager: `none -> creating -> created -> starting -> ready -> stopping -> stopped -> destroyed` with observer callbacks, force-destroy, and snapshot serialization |
| `go/internal/sandbox/artifact_transport.go` | sandbox | SHA-256 digest-verified file import/export with path-jail enforcement (directory-traversal prevention via `filepath.EvalSymlinks`) and recursive directory import |
| `go/internal/builderexec/reconciler.go` | builderexec | 4-way lifecycle reconciler (Attempt x Pane x Sandbox x Process) with pluggable probes, orphan detection, and corrective cleanup actions |
| `go/internal/builderexec/sandbox_provider.go` | builderexec | `SandboxProvider` interface and `AgentENVSandboxProvider` implementation that orchestrates acquire/release through the lifecycle manager, plus exec and artifact delegation |
| `go/internal/scheduler/committing_dispatcher.go` | scheduler | Committing dispatch with fencing tokens, WIP limits (global / per-goal / per-account), dry-run/committing mode toggle, decision logging, and event-sink emission |
| `go/internal/allocator/live_scoring_allocator.go` | allocator | Live scoring allocator with pluggable `ScoringFunc`, capacity checks, tag-based affinity filtering, advisory/live mode toggle, feedback sink for outcome tracking, and reason-coded allocation decisions |

### Test files (6)

| File | Test count | Coverage focus |
|------|------------|----------------|
| `go/internal/sandbox/sandbox_test.go` | 11 | AgentENVClient CRUD, auth headers, error mapping, ContainerLifecycle happy path + invalid transition + failure + snapshot + force-destroy, state transition completeness |
| `go/internal/sandbox/artifact_transport_test.go` | 6 | Path-jail allow/block/sibling, SHA-256 on-disk hashing, import/export jail violation |
| `go/internal/builderexec/reconciler_test.go` | 7 | No-orphan pass, orphan detect+clean, mixed alive/dead, untrack, last-result caching, probe error propagation, resource-key uniqueness |
| `go/internal/builderexec/sandbox_provider_test.go` | 5 | Acquire/release lifecycle, release-not-found error, exec delegation, release-all bulk teardown, import/export not-found guards |
| `go/internal/scheduler/committing_dispatcher_test.go` | -- | Committing dispatch, fencing-token persistence, WIP limit enforcement, dry-run vs committing mode, idempotent re-dispatch, decision log, event sink emission |
| `go/internal/allocator/live_scoring_allocator_test.go` | -- | Live scoring, capacity rejection, tag-affinity filtering, advisory vs live mode, feedback sink, allocation log |

### Verification script

| File | Purpose |
|------|---------|
| `plans/scripts/verify-phase-08-steps-11-17.sh` | Automated verification: file existence, `go vet`, `go build`, per-package `go test -v`, full-module test sweep |

---

## Architecture

### Container Runtime Design

```
AgentENVClient (REST/HTTP)
    |
    +-- CreateSandbox / DestroySandbox / ExecInSandbox
    |       |
    |   ContainerLifecycle (FSM)
    |       none -> creating -> created -> starting -> ready -> stopping -> stopped -> destroyed
    |       (any state) -> failed
    |       ForceDestroy bypasses state machine for orphan cleanup
    |
    +-- ImportArtifact / ExportArtifact
            |
        ArtifactTransport
            SHA-256 digest on import (computed before send)
            SHA-256 verify on export (API digest vs on-disk hash)
            Path-jail enforcement via filepath.EvalSymlinks
```

### Reconciler Design

The 4-way reconciler manages the cross-product of Attempt, Pane, Sandbox, and
Process resources:

```
Reconciler.Reconcile(ctx)
    |
    Phase 1: Probe
    |   For each tracked resource:
    |     1. Check owning Attempt via AttemptProbe
    |     2. If Attempt dead -> mark resource as Orphan
    |     3. If Attempt alive -> probe resource itself
    |
    Phase 2: Cleanup
    |   For each orphan:
    |     Pane    -> PaneProbe.DestroyPane()
    |     Sandbox -> SandboxProbe.DestroySandbox()
    |     Process -> ProcessProbe.KillProcess()
    |   Remove from tracking on success
    |
    Phase 3: Update
        Persist new states to tracked-resource map
        Cache ReconcileResult for status endpoint
```

Key design decisions:
- **Interface-per-probe**: each resource kind has its own probe interface, enabling
  independent mock/stub replacement in tests.
- **Attempt-centric orphan detection**: a resource is orphaned if and only if its
  owning Attempt is dead, preventing premature cleanup during transient resource
  restarts.
- **Snapshot-then-reconcile**: the reconciler snapshots the resource map under the
  lock, then probes and cleans without holding it, avoiding lock contention during
  slow network probes.
- **Error isolation**: probe errors are recorded but do not halt the reconciliation
  pass; the resource is marked `unknown` and retried on the next cycle.

### Sandbox Provider Design

```
SandboxProvider (interface)
    Acquire(ctx, req) -> SandboxHandle
    Release(ctx, id)
    Exec(ctx, id, req)
    ImportArtifact / ExportArtifact

AgentENVSandboxProvider (production impl)
    Acquire:
      1. Generate sandbox ID from attempt ID + counter
      2. ContainerLifecycle.Create(ctx) -> created
      3. ContainerLifecycle.Start(ctx)  -> ready (health probe via exec "true")
      4. Wire ArtifactTransport
      5. Return SandboxHandle{Lifecycle, Transport}
    Release:
      1. Stop (if ready) -> stopped
      2. Destroy -> destroyed
      3. Fallback: ForceDestroy on any error
    ReleaseAll:
      ForceDestroy every active sandbox (shutdown path)
```

### Digest-Pinned Images

All container image references use `DigestPinnedImage` which produces canonical
`repository@sha256:...` references. This eliminates tag mutability as a source
of non-reproducibility.

### Committing Dispatcher

```
CommittingDispatcher.Dispatch(attemptID)
    1. Fetch Attempt from AttemptStore
    2. If already dispatched -> idempotent success (return existing token)
    3. List active attempts, check WIP limits:
       - Global cap
       - Per-goal cap
       - Per-account cap
    4. Generate 16-byte hex fencing token
    5. If mode == committing: AttemptStore.SetFencingToken() (CAS semantics)
    6. Record decision + emit SchedulerEvent
```

### Live Scoring Allocator

```
LiveScoringAllocator.Allocate(req)
    1. Filter builders by capacity (ActiveCount < Capacity)
    2. Filter by tag affinity (all requested tags must match)
    3. Score remaining candidates via ScoringFunc
    4. Select highest-scoring builder
    5. If mode == live: commit assignment
    6. Record decision with reason code + emit event
```

---

## Test Evidence

### Sandbox package (17 tests)

- `TestDigestPinnedImageReference`: verifies `repository@digest` format
- `TestCreateSandbox`: POST /api/v1/sandboxes with auth header, JSON request/response
- `TestDestroySandbox`: DELETE /api/v1/sandboxes/{id} with 204 No Content
- `TestExecInSandbox`: POST exec endpoint, exit code and stdout capture
- `TestAPIErrorResponse`: non-2xx mapped to `AgentENVAPIError` with status code
- `TestWithHTTPClient`: functional option applies custom `http.Client`
- `TestContainerLifecycleHappyPath`: full FSM traversal none->created->ready->stopped->destroyed with 7 transition events
- `TestContainerLifecycleInvalidTransition`: Stop from none state rejected
- `TestContainerLifecycleCreateFailure`: API error transitions to failed state, LastError populated
- `TestContainerLifecycleSnapshot`: serializable snapshot with sandbox ID, image reference, state
- `TestContainerLifecycleForceDestroy`: bypasses normal state machine from created state
- `TestValidTransitionsCompleteness`: ensures every non-terminal target state has outgoing edges
- `TestValidatePathJailAllowsInsidePath`: subdir path accepted
- `TestValidatePathJailBlocksEscape`: `../` traversal rejected
- `TestValidatePathJailAllowsRootItself`: root == target allowed
- `TestValidatePathJailBlocksSiblingPrefix`: `/workspace-other` rejected when root is `/workspace`
- `TestHashFileOnDisk`: SHA-256 hex digest matches expected value

### Builderexec package (12 tests)

- `TestReconcilerNoOrphans`: all resources alive, zero orphans detected/cleaned
- `TestReconcilerDetectsAndCleansOrphans`: dead attempt causes 3 orphans, all cleaned, tracking emptied
- `TestReconcilerMixedAliveAndDead`: one alive + one dead attempt, only orphaned resource cleaned
- `TestReconcilerUntrack`: explicit untrack removes resource from supervision
- `TestReconcilerLastResult`: nil before first pass, populated after
- `TestReconcilerProbeError`: attempt probe failure recorded as error, no false orphan
- `TestResourceKeyUniqueness`: `pane:id-1` differs from `sandbox:id-1`
- `TestAgentENVSandboxProviderAcquireRelease`: full acquire->release lifecycle with mock server
- `TestAgentENVSandboxProviderReleaseNotFound`: error on unknown sandbox ID
- `TestAgentENVSandboxProviderExecDelegation`: exec forwarded to AgentENV, exit code + stdout verified
- `TestAgentENVSandboxProviderReleaseAll`: 3 sandboxes acquired, all force-destroyed
- `TestAgentENVSandboxProviderImportExportNotFound`: import/export on unknown sandbox returns error

### Scheduler + Allocator packages

- CommittingDispatcher: fencing-token persistence with CAS, WIP limit checks (global/goal/account), dry-run mode does not persist, idempotent re-dispatch returns existing token, decision log and event sink emission
- LiveScoringAllocator: pluggable scoring function, capacity filtering, tag-affinity matching, advisory vs live mode, feedback sink integration, reason-coded allocation decisions

---

## State Machine Reference

### Container Lifecycle States

| State | Description | Valid transitions |
|-------|-------------|-------------------|
| (none) | Initial, not yet created | creating |
| creating | API call in flight | created, failed |
| created | Container provisioned | starting, destroyed, failed |
| starting | Health probe in flight | ready, failed |
| ready | Container accepting work | stopping, failed |
| stopping | Graceful shutdown in progress | stopped, failed |
| stopped | Container halted | destroyed, failed |
| destroyed | Terminal, resources freed | (none) |
| failed | Terminal error state | destroyed |

### Resource States (Reconciler)

| State | Meaning |
|-------|---------|
| alive | Resource running, owning attempt active |
| stopped | Resource not responding but attempt alive |
| unknown | Probe errored, will retry next cycle |
| orphan | Owning attempt dead, scheduled for cleanup |

---

## Verification

Run the automated verification script:

```bash
bash plans/scripts/verify-phase-08-steps-11-17.sh
```

The script performs:
1. Prerequisite check (Go toolchain, go.mod)
2. Source file existence (7 files)
3. Test file existence (6 files)
4. `go vet` on all 4 packages
5. `go build` on all 4 packages
6. `go test -v -count=1` per package (sandbox, builderexec, scheduler, allocator)
7. Full-module `go test ./...`

---

## Files Created/Modified This Session

| Path | Action |
|------|--------|
| `go/internal/sandbox/agentenv_client.go` | Created |
| `go/internal/sandbox/container_lifecycle.go` | Created |
| `go/internal/sandbox/artifact_transport.go` | Created |
| `go/internal/sandbox/sandbox_test.go` | Created |
| `go/internal/sandbox/artifact_transport_test.go` | Created |
| `go/internal/builderexec/reconciler.go` | Created |
| `go/internal/builderexec/sandbox_provider.go` | Created |
| `go/internal/builderexec/reconciler_test.go` | Created |
| `go/internal/builderexec/sandbox_provider_test.go` | Created |
| `go/internal/scheduler/committing_dispatcher.go` | Created |
| `go/internal/scheduler/committing_dispatcher_test.go` | Created |
| `go/internal/allocator/live_scoring_allocator.go` | Created |
| `go/internal/allocator/live_scoring_allocator_test.go` | Created |
| `plans/scripts/verify-phase-08-steps-11-17.sh` | Created |
| `plans/reports/session-112-phase-08-steps-11-17-complete.md` | Created |
