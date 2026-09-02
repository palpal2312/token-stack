# Phase 03: Headroom Daemon Supervisor & Multi-Instance Engine

## Context Links
- Parent Plan: [plan.md](file:///C:/Users/ADMIN/Documents/token-stack/plans/260902-2335-token-stack-architecture-overhaul/plan.md)
- Sub2API Daemonization: Systemd service and background worker in Go

## Overview
- **Date**: 2026-09-02
- **Description**: Implement a robust background process supervisor that keeps Headroom proxy instances alive, eliminates subshell termination bugs, and provides automatic recovery on crash.
- **Priority**: P1
- **Implementation Status**: pending
- **Review Status**: pending

## Key Insights
- Headroom proxies started inside bash or child subshells die when the subshell terminates (observed repeatedly during Claude CLI sessions).
- On Windows, detached processes must break away from job objects or be managed by a persistent daemon task.
- Each instance requires an isolated port and `--memory-db-path`. If a process crashes, the supervisor should catch it and restart it automatically.

## Requirements
1. Build `daemons/headroom-supervisor.ps1`:
   - Can run as a continuous background watcher or on-demand manager.
   - Reads all active profiles from `token-stack.registry.json`.
   - Checks `/readyz` for each assigned port.
   - Starts missing instances using `Start-Process -WindowStyle Hidden` with explicit arguments.
   - Traps exit signals and performs clean shutdowns (`SIGTERM`/`Stop-Process`).
2. Implement auto-healing:
   - If a port returns connection refused or times out for > 3 consecutive checks, re-spawn the instance.
3. Windows Task Scheduler / Service integration:
   - Provide `deploy/install-supervisor-task.ps1` to register a Windows Scheduled Task running on user login, ensuring Headroom is always available without manual intervention.

## Related Files
- `C:\Users\ADMIN\Documents\token-stack\daemons\headroom-supervisor.ps1`
- `C:\Users\ADMIN\Documents\token-stack\deploy\install-supervisor-task.ps1`
- `C:\Users\ADMIN\Documents\token-stack\core\registry.ps1`

## Implementation Steps
1. Write process detection and socket probing logic in `headroom-supervisor.ps1`.
2. Implement launch commands with full absolute paths and `-memory-db-path` isolation.
3. Add loop polling with configurable intervals (default: 15 seconds).
4. Provide `token-stack up` and `token-stack down` integration.
5. Create deployment script for Windows Task Scheduler.

## Todo List
- [ ] Create `daemons/headroom-supervisor.ps1`
- [ ] Add auto-recovery loop with backoff
- [ ] Create `deploy/install-supervisor-task.ps1`
- [ ] Test graceful shutdown of multiple instances

## Success Criteria
- Killing a Headroom process manually results in the supervisor restarting it within 15 seconds.
- Background instances persist across closing and reopening terminal windows.
