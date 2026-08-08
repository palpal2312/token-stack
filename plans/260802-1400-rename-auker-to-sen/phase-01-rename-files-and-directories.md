---
phase: 1
title: Rename Files and Directories
status: completed
effort: medium
---

# Phase 1: Rename Files and Directories

## Overview
Perform `mv` commands to rename all files and folders containing `sen` (case-insensitive) to `sen`.

## Implementation Steps
1. Rename app directories: `src/app/sen` -> `src/app/sen` and `src/app/api/sen` -> `src/app/api/sen`.
2. Rename components: `SenView.tsx` -> `SenView.tsx`, `SenKnowledgeBase.tsx` -> `SenKnowledgeBase.tsx`.
3. Rename context: `sen-panel-context.tsx` -> `sen-panel-context.tsx`.
4. Rename `src/lib/` files: `sen.ts`, `sen-config.ts`, `sen-models.ts`, `sen-sessions.ts`, `senKnowledgeFiles.ts` to `sen*`.
5. Rename preset files: `src/lib/agentRuntime/presets/sen.ts` -> `sen.ts` and `sen-meta.ts` -> `sen-meta.ts`.

## Success Criteria
- [ ] No files named `sen` remain in the codebase.
- [ ] File structure remains intact.

## Risk Assessment
- Renaming files breaks imports until Phase 2 completes. Tests will temporarily fail.
