---
phase: 3
title: Update API Routes and URLs
status: completed
effort: medium
---

# Phase 3: Update API Routes and URLs

## Overview
Update all network requests (`fetch`) and API endpoints to match the new `/sen` routes.

## Implementation Steps
1. Replace `fetch("/api/sen/...")` with `fetch("/api/sen/...")` in UI components (e.g. `SenView.tsx`).
2. Update internal redirects in Next.js backend (e.g. `src/app/api/firstmate/chat/route.ts`).
3. Ensure dynamic segments like `[id]` still work.

## Success Criteria
- [ ] No `404 Not Found` errors when fetching agent sessions or chat endpoints. (OPEN: historical plan dir; see roadmap track record)
- [ ] The web UI properly connects to the new API routes. (OPEN: historical plan dir; see roadmap track record)

## Risk Assessment
- Hardcoded URLs in legacy integration components (like `HermesTalk`) might be missed. Ensure global grep for `/api/sen`.
