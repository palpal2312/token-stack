# Phase 01: Directory Reorganization & Centralized Registry

## Context Links
- Parent Plan: [plan.md](file:///C:/Users/ADMIN/Documents/token-stack/plans/260902-2335-token-stack-architecture-overhaul/plan.md)
- Sub2API Layout: [C:\Users\ADMIN\Documents\Agent OS\sub2api](file:///C:/Users/ADMIN/Documents/Agent%20OS/sub2api)
- Current Token-Stack: [C:\Users\ADMIN\Documents\token-stack](file:///C:/Users/ADMIN/Documents/token-stack)

## Overview
- **Date**: 2026-09-02
- **Description**: Reorganize repo root into modular directories (`bin/`, `core/`, `daemons/`, `deploy/`, `templates/`) and implement declarative `token-stack.registry.json` with dynamic port & memory DB allocator.
- **Priority**: P1
- **Implementation Status**: pending
- **Review Status**: pending

## Key Insights
- In `sub2api`, account configurations, port bindings, and model whitelists are managed declaratively with strict isolation.
- `token-stack` currently relies on reading individual `.env.<profile>` files, making it easy to encounter port conflicts (e.g. 5173 vs 9284) and SQLite memory locks.
- A centralized manifest (`token-stack.registry.json`) provides a single source of truth for all profiles, assigned ports, upstreams, and SQLite database paths.

## Requirements
1. Define the new repository directory tree:
   - `bin/`: CLI binaries and shell wrappers.
   - `core/`: Reusable PowerShell & Node modules (Registry, PortAllocator, Verifier).
   - `daemons/`: Background proxy supervisors and health watchers.
   - `deploy/`: Systemd unit templates & Windows task automation scripts.
   - `templates/`: Provider presets (Antigravity, Kimi, Alibaba, OpenAI).
2. Create `core/registry.ps1`:
   - `Get-TokenStackRegistry`: Reads or initializes `token-stack.registry.json`.
   - `Register-TokenStackProfile`: Adds/updates a profile entry.
   - `Allocate-TokenStackPort`: Scans range 8787-9999, guarantees free socket, and assigns uniquely.
   - `Ensure-ProfileDbDirectory`: Pre-creates `~/.<profile>/headroom-data/`.
3. Backward Compatibility:
   - Provide shims or retain `scripts/` forwarding to `core/` so existing hooks and junctions continue functioning seamlessly.

## Architecture
```text
token-stack/
├── bin/
│   ├── token-stack.ps1       <-- Core CLI dispatcher
│   └── token-stack.cmd       <-- Windows CMD/Terminal wrapper
├── core/
│   ├── registry.ps1          <-- State & Profile database
│   ├── port-allocator.ps1    <-- Dynamic port reservation
│   └── verifier.ps1          <-- 3-stage validation logic
├── daemons/
│   └── headroom-supervisor.ps1 <-- Background keep-alive engine
├── deploy/
│   └── register-task.ps1     <-- Windows Scheduled Task installer
└── token-stack.registry.json <-- Central configuration file
```

## Related Files
- `C:\Users\ADMIN\Documents\token-stack\core\registry.ps1`
- `C:\Users\ADMIN\Documents\token-stack\core\port-allocator.ps1`
- `C:\Users\ADMIN\Documents\token-stack\token-stack.registry.json`
- `C:\Users\ADMIN\Documents\token-stack\scripts\headroom-ensure.ps1`

## Implementation Steps
1. Create `bin/`, `core/`, `daemons/`, `deploy/`, `templates/` directories.
2. Implement `core/port-allocator.ps1` with socket testing and registry conflict checks.
3. Implement `core/registry.ps1` to seed current active profiles (`default`, `kimicode`, `sub2api-01`, `sub2api-02`).
4. Generate the initial `token-stack.registry.json`.
5. Update `scripts/headroom-ensure.ps1` to consult `core/registry.ps1`.

## Todo List
- [ ] Create folder structure
- [ ] Write `core/port-allocator.ps1`
- [ ] Write `core/registry.ps1`
- [ ] Generate default `token-stack.registry.json`
- [ ] Validate backwards compatibility with existing launcher scripts

## Success Criteria
- Running `Get-TokenStackRegistry` returns all 4 existing profiles with correct ports (8787, 8788, 8790, 8807).
- Requesting a new port dynamically yields 8808+ without collision.

## Risk Assessment & Rollback
- **Risk**: Moving scripts could break active session hooks.
- **Mitigation**: Retain `scripts/headroom-ensure.ps1` as a compatibility bridge forwarding to `core/`.
