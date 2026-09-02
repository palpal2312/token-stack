# Phase 05: Documentation, Provider Templates & DX Tooling

## Context Links
- Parent Plan: [plan.md](file:///C:/Users/ADMIN/Documents/token-stack/plans/260902-2335-token-stack-architecture-overhaul/plan.md)
- Sub2API DX: `Makefile`, `DEV_GUIDE.md`, multi-lingual README

## Overview
- **Date**: 2026-09-02
- **Description**: Standardize developer experience with `Makefile`, provider templates (`templates/`), updated multi-lingual documentation, and synchronized agent skills.
- **Priority**: P2
- **Implementation Status**: completed
- **Review Status**: verified

## Key Insights
- Clean documentation and pre-configured templates prevent users from repeating common configuration mistakes.
- Adding a `Makefile` allows developers and CI/CD pipelines to run standardized targets (`make test`, `make doctor`, `make up`).

## Requirements
1. Create `templates/` directory with production-ready profile presets:
   - `templates/kimi.json`: Kimi Coding API preset with `kimi-k3`.
   - `templates/antigravity.json`: Sub2API / Antigravity preset with `claude-sonnet-4-5-thinking`.
   - `templates/alibaba.json`: Alibaba MaaS preset with `qwen3.8-max` / `deepseek-v4`.
   - `templates/bedrock.json`: AWS Bedrock preset.
2. Create `Makefile`:
   - `make doctor`: Runs `token-stack doctor`.
   - `make verify`: Runs `token-stack verify`.
   - `make up`: Runs `token-stack up`.
   - `make down`: Runs `token-stack down`.
   - `make bench`: Runs `token-stack bench`.
3. Update `README.md`, `README-vi.md`, and `docs/architecture.md`:
   - Document the 2.0 modular architecture.
   - Add the quickstart CLI cheat-sheet.
4. Synchronize Agent Skills:
   - Update `skills/token-stack/` and `skills/token-stack-setup/` to expose the new CLI capabilities.

## Related Files
- `C:\Users\ADMIN\Documents\token-stack\Makefile`
- `C:\Users\ADMIN\Documents\token-stack\templates\`
- `C:\Users\ADMIN\Documents\token-stack\README.md`
- `C:\Users\ADMIN\Documents\token-stack\README-vi.md`

## Implementation Steps
1. Create provider template files in `templates/`.
2. Write `Makefile` with standard cross-platform targets.
3. Update `README.md` and `README-vi.md`.
4. Validate skill integration in `skills/`.

## Todo List
- [ ] Create `templates/` presets
- [ ] Write `Makefile`
- [ ] Update `README.md` & `README-vi.md`
- [ ] Sync skill files with new subcommands

## Success Criteria
- Running `make doctor` executes successfully.
- Provider templates provide instant 1-click configuration for new agent profiles.
