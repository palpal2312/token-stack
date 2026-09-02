# Phase 02: Unified CLI Dispatcher (`token-stack`)

## Context Links
- Parent Plan: [plan.md](file:///C:/Users/ADMIN/Documents/token-stack/plans/260902-2335-token-stack-architecture-overhaul/plan.md)
- Sub2API Entrypoint: `sub2api` main command / web UI

## Overview
- **Date**: 2026-09-02
- **Description**: Build a unified command-line tool `token-stack` that provides subcommands for diagnostics, profile orchestration, proxy lifecycle, and benchmarking.
- **Priority**: P1
- **Implementation Status**: pending
- **Review Status**: pending

## Key Insights
- Currently, operators must execute 6 distinct scripts across various directories with manual flags.
- `sub2api` succeeds because users can manage accounts, proxies, and settings through a unified surface.
- A single `token-stack` CLI with intuitive subcommands significantly lowers cognitive burden.

## Requirements
1. Create `bin/token-stack.ps1` with subcommands:
   - `doctor`: Comprehensive health audit across all 7 layers and configured profiles.
   - `profile [list|add|remove|show]`: Profile CRUD and port/DB allocation.
   - `up [--all | <profile>]`: Start Headroom instances for profiles.
   - `down [--all | <profile>]`: Gracefully stop Headroom instances.
   - `status`: Display a tabular live overview of all profiles, ports, upstream health, and memory stats.
   - `verify [<profile>]`: Execute 3-stage validation pipeline.
   - `bench`: Launch benchmark runner.
   - `report`: Output token savings summary.
2. Create `bin/token-stack.cmd` wrapper so users can type `token-stack` directly in any Windows terminal.
3. Automatically register `bin/` in the user's PATH or npm global directory.

## Command Specifications
```powershell
token-stack status
# Output:
# Profile      Port   Upstream                     Ready   Model
# -------      ----   --------                     -----   -----
# default      8787   https://api.anthropic.com    OK      claude-sonnet-4-5
# kimicode     8788   https://api.kimi.com/coding  OK      kimi-k3
# sub2api-01   8790   http://127.0.0.1:9284        OK      claude-sonnet-4-5-thinking
# sub2api-02   8807   http://127.0.0.1:9284        OK      claude-sonnet-4-5-thinking
```

## Related Files
- `C:\Users\ADMIN\Documents\token-stack\bin\token-stack.ps1`
- `C:\Users\ADMIN\Documents\token-stack\bin\token-stack.cmd`
- `C:\Users\ADMIN\Documents\token-stack\core\registry.ps1`

## Implementation Steps
1. Implement argument parsing and command routing in `bin/token-stack.ps1`.
2. Connect `status` and `doctor` to `token-stack-health.ps1`.
3. Connect `profile` subcommands to `core/registry.ps1`.
4. Connect `up`/`down` to `daemons/headroom-supervisor.ps1`.
5. Create `bin/token-stack.cmd` for PATH discovery.

## Todo List
- [ ] Implement `bin/token-stack.ps1` router
- [ ] Implement `status` formatted table
- [ ] Implement `profile` management subcommands
- [ ] Implement `up` and `down` hooks
- [ ] Create `bin/token-stack.cmd`

## Success Criteria
- Typing `token-stack status` in terminal outputs the live table of all 4 profiles.
- Typing `token-stack doctor` audits the full 7-layer stack without errors.
