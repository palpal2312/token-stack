---
phase: 2
title: "Provisioning and canary"
status: pending
priority: P1
effort: ""
dependencies: [1]
---

# Phase 2: Provisioning and canary

## Overview
Deploy current image to the chosen host (docker run pattern from S17), wire
probes, and run a monitored canary with SLO thresholds.

## Implementation Steps
1. Deploy via `docker run` (S17 image) with env from preflight.
2. Stand up SLO probes (reuse S18 loop) against the host.
3. Write canary turns to canonical store; verify read-back + RPO/RTO bounds.

## Success Criteria
- [ ] Host healthz 200; canary write durable; SLO within thresholds.
