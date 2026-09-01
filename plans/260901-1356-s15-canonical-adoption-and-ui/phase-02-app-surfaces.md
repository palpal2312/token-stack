---
phase: 2
title: "App surfaces for Go projections"
status: pending
priority: P1
effort: ""
dependencies: [1]
---

# Phase 2: App surfaces for Go projections

## Overview
Surface sen-plane's store-backed data in the UI: runtime slots, attempts, and
store-backed chat — replacing proxy-only/empty surfaces.

## Requirements
- Functional: slots/attempts views read real sen-plane data (empty store shows
  empty state, not error); chat view uses canonical receipts (Phase 1 mapping).
- Non-functional: sen-plane unavailable => clear degraded UI, never a crash.

## Related Code Files
- Modify: `src/app/api/herdr/slots/route.ts` consumers, attempts views,
  `src/components/OrcaSlotStatus.tsx`, `WorkerHealth.tsx`, SEN views.
- Reuse: `go-builder-exec-client` readers, `orca-slot-client` parse.

## Implementation Steps
1. Point the slots/attempts UI at `readRuntimeSlots`/`readRuntimeProjection`
   live path (daemon), keeping DISABLED fallback.
2. Wire SEN chat UI to the canonical round-trip.
3. Probe with the real store: 9 sessions visible, canary session in UI.

## Success Criteria
- [x] UI shows store-backed counts and empty-state for empty projections. (_evidence: see CLOSED_GO record)
- [x] No fabricated data on any surface (fixtures gated to test env). (_evidence: see CLOSED_GO record)
## Risk Assessment
UI consumes a DTO shape not yet used — signal: schema drift in the view;
response: assert with the shared parser before mounting.