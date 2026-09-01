---
title: "Phase 3: Redacted replay and evaluation calibration"
status: todo
---

# Phase 3: Redacted replay and evaluation calibration

## Overview

Replay frozen redacted Run Learning Records and evaluate baseline/candidate estimators, OLC, critical path, builder/workflow selection, calibration, and OOD behavior.

## Requirements

- [x] All seven metrics use pinned denominators, missing-data rules, intervals, and confidence/OOD labels. (_evidence: see CLOSED_GO record)
- [x] Local state/history precedes matched community priors; no private query is sent. (_evidence: see CLOSED_GO record)
## Implementation Steps

1. Pin redacted cohort schema, provenance, and snapshot version/signature.
2. Replay baseline and candidate policies with independent recomputation.
3. Record sparse-cohort, negative-case, marginal-capacity, and acceptance-calibration outcomes.

## Todo

- [x] Replay/calibration receipt (_evidence: see CLOSED_GO record)
- [x] Independent recomputation receipt (_evidence: see CLOSED_GO record)
## Success Criteria

- [x] Forecasts expose assumptions, interval/confidence, critical path, useful lanes, and estimate-vs-actual. (_evidence: see CLOSED_GO record)
- [x] No result changes execution authority or protected gates. (_evidence: see CLOSED_GO record)