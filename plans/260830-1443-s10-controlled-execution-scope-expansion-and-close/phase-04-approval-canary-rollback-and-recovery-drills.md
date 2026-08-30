---
title: "Phase 4: Approval canary rollback and recovery drills"
status: todo
---

# Phase 4: Approval canary rollback and recovery drills

## Overview

Prove approval-gated promotion behavior, monitored canary and valid rejection/no-op, reversible rollback, and the authorized recovery drills.

## Requirements

- [ ] Unapproved candidates fail closed; canary has monitoring and an independent acceptance outcome.
- [ ] Rollback and recovery cover daemon, restore, duplicate outbox, stale lease, unavailable backend, and invalid snapshot cases.

## Implementation Steps

1. Run baseline/candidate canary with approval and alert thresholds.
2. Exercise rejection, no-op, rollback, duplicate suppression, and recovery restart.
3. Capture bounded SLO/RPO/RTO and incident/runbook evidence.

## Todo

- [ ] Canary/rollback receipt
- [ ] Recovery-drill receipt and runbooks

## Success Criteria

- [ ] Every promotion path is approval- and canary-gated.
- [ ] Legacy canonical writes remain disabled during rollback and recovery.
