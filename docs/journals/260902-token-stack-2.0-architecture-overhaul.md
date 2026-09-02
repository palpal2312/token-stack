# Technical Journal: Token-Stack 2.0 Architecture Overhaul (Inspired by Sub2API)

- **Date**: 2026-09-02T23:41:00+07:00
- **Author**: Antigravity / ClaudeKit Engineer
- **Scope**: Re-architecture of `palpal2312/token-stack` repository
- **Commit**: `786a6ae`

## 1. Problem Statement & Motivation
Before this overhaul, `token-stack` was an effective conceptual 7-layer framework, but suffered from operational fragmentation:
- Configuration was scattered across disparate `.env.<profile>` files and individual `claude-*.ps1` wrapper scripts.
- Port collisions were frequent (e.g. Sub2API dev port 5173 vs production 9284).
- Headroom proxy instances were tied to terminal subshells; closing a session or running subagents caused `ConnectionRefused` errors.
- Troubleshooting was reactive and lacked an automated E2E streaming verification mechanism.

## 2. Structural Patterns Adopted from Sub2API
Studying `Wei-Shaw/sub2api` revealed key architectural patterns that were directly integrated into Token-Stack 2.0:
1. **Centralized Declarative Registry (`token-stack.registry.json`)**:
   - Acts as the Single Source of Truth for all agent profiles, assigned ports, upstreams, and SQLite memory paths.
2. **Dynamic Port & Resource Allocator (`core/port-allocator.ps1`)**:
   - Performs active socket probing across ports 8787-9999 before reservation, preventing multi-instance collisions.
3. **Unified CLI Dispatcher (`bin/token-stack.ps1`, `bin/token-stack.cmd`)**:
   - Provides intuitive subcommands: `status`, `doctor`, `up`, `down`, `verify`, `profile`.
4. **Persistent Process Supervisor (`daemons/headroom-supervisor.ps1`)**:
   - Replaces fragile shell hooks with continuous background monitoring, auto-recovering crashed proxy instances.
5. **3-Stage Automated E2E Verification Pipeline (`core/verifier.ps1`)**:
   - Tests Proxy Liveness (`/readyz`), Direct Upstream Stream, and Proxy-Mediated Stream before declaring readiness.
6. **Standardized DX Tooling (`Makefile`, `templates/`)**:
   - Pre-configured presets for Antigravity, Kimi, Alibaba, and one-click Makefile targets.

## 3. Verification & Live Results
- `token-stack status` displays live table of all 5 configured profiles.
- `token-stack verify kimicode`: All 3 stages PASS in <4s.
- `token-stack verify sub2api-01`: All 3 stages PASS in <2s.
- `token-stack verify sub2api-02`: All 3 stages PASS in <3s.
- Tested and verified globally accessible via `%APPDATA%\npm\token-stack.cmd`.
