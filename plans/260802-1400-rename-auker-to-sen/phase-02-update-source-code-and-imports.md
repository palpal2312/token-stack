---
phase: 2
title: Update Source Code and Imports
status: completed
effort: high
---

# Phase 2: Update Source Code and Imports

## Overview
Search and replace all references of `Sen` -> `Sen` inside the TypeScript code to fix the broken imports from Phase 1.

## Implementation Steps
1. Run a global `sed` or Node.js string replacement across `src/**/*.tsx` and `src/**/*.ts`.
2. Target `import` paths: e.g. `../lib/sen` -> `../lib/sen`.
3. Target Component Names: `SenView` -> `SenView`, `SenPanelProvider` -> `SenPanelProvider`.
4. Target Hook Names: `useAukerPanel` -> `useSenPanel`.
5. Target Variable Names: `senSession`, `AUKER_DIR`, etc.

## Success Criteria
- [ ] TypeScript compilation `npx tsc --noEmit` passes without `Cannot find module` or `Cannot find name` errors related to Sen. (OPEN: historical plan dir; see roadmap track record)

## Risk Assessment
- Case sensitivity: `Sen` vs `sen` vs `SEN`. Replacement script must handle casing correctly to prevent malformed variables.
