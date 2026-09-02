---
title: "Token-Stack 2.0 Architecture Overhaul (Inspired by Sub2API)"
description: "Restructure token-stack into a modular, production-grade CLI architecture with unified registry, supervisor daemon, and E2E verification."
status: completed
priority: P1
effort: 6h
branch: main
tags: [token-stack, sub2api, architecture, cli, daemon, verification]
created: 2026-09-02
---

# Token-Stack 2.0 Architecture Overhaul

Re-architecting `token-stack` adopting the clean modularity, process supervision, and robust observability patterns of `sub2api`.

## Phases & Execution Roadmap

| Phase | Description | Status | Est. Effort | Details Link |
|:---|:---|:---:|:---:|:---|
| **Phase 01** | Directory Reorganization & Centralized Registry | completed | 1.5h | [phase-01-directory-reorganization-and-registry.md](file:///C:/Users/ADMIN/Documents/token-stack/plans/260902-2335-token-stack-architecture-overhaul/phase-01-directory-reorganization-and-registry.md) |
| **Phase 02** | Unified CLI Dispatcher (`token-stack`) | completed | 1.5h | [phase-02-unified-cli-dispatcher.md](file:///C:/Users/ADMIN/Documents/token-stack/plans/260902-2335-token-stack-architecture-overhaul/phase-02-unified-cli-dispatcher.md) |
| **Phase 03** | Headroom Daemon Supervisor & Multi-Instance Engine | completed | 1.0h | [phase-03-headroom-daemon-supervisor.md](file:///C:/Users/ADMIN/Documents/token-stack/plans/260902-2335-token-stack-architecture-overhaul/phase-03-headroom-daemon-supervisor.md) |
| **Phase 04** | Automated 3-Stage E2E Verification Pipeline | completed | 1.0h | [phase-04-automated-e2e-verification-pipeline.md](file:///C:/Users/ADMIN/Documents/token-stack/plans/260902-2335-token-stack-architecture-overhaul/phase-04-automated-e2e-verification-pipeline.md) |
| **Phase 05** | Documentation, Provider Templates & DX Tooling | completed | 1.0h | [phase-05-documentation-and-dx.md](file:///C:/Users/ADMIN/Documents/token-stack/plans/260902-2335-token-stack-architecture-overhaul/phase-05-documentation-and-dx.md) |

## Dependencies & Pre-requisites
- Existing agent profiles (`.claude`, `.claude-kimicode`, `.claude-sub2api`, `.claude-sub2api-02`) must be preserved without credential loss.
- Backward compatibility with existing skill paths and symlinks.

## Acceptance Criteria
- [ ] Single CLI command `token-stack <command>` works out of the box.
- [ ] Centralized manifest `token-stack.registry.json` tracks all profiles, ports, and upstreams without collisions.
- [ ] Headroom supervisor keeps instances alive and resilient against terminal subshell reaps.
- [ ] E2E verifier proves stream connectivity before declaring any profile ready.
