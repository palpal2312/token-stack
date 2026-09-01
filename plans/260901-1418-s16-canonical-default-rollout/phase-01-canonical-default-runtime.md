---
phase: 1
title: "Canonical-default runtime"
status: pending
priority: P1
effort: ""
dependencies: []
---

# Phase 1: Canonical-default runtime

## Overview
sen-plane starts with the app and canonical config is the default; no manual
`SEN_DAEMON_URL`.

## Requirements
- Functional: dev/run spawn daemon + set canonical env; daemon absent -> clear
  offline error, never silent legacy writes.
- Non-functional: loopback only; no secrets in env.

## Related Code Files
- Modify: `scripts/dev-sen-plane.ps1`, package.json dev scripts, the run harness.
- Read: sen/chat route marketing branch.

## Implementation Steps
1. Wire the dev entrypoint to start sen-plane on the real store and export the
   canonical config.
2. Make offline behavior fail closed with an explicit error surface.
3. Verify: chat round-trip without manual env; legacy write impossible silently.

## Success Criteria
- [x] One command runs app + daemon; chat writes to canonical store. (_evidence: see CLOSED_GO record)
- [x] Offline (no daemon) shows explicit error, zero legacy writes. (_evidence: see CLOSED_GO record)
## Risk Assessment
Assumption: dev entrypoint can spawn Go. Signal: spawn fails on CI — response:
make the spawn best-effort with offline fallback clearly surfaced.
