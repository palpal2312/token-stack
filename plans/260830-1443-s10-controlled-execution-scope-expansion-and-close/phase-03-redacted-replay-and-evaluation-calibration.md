---
title: "Phase 3: Redacted replay and evaluation calibration"
status: todo
---

# Phase 3: Redacted replay and evaluation calibration

## Overview

Replay frozen redacted Run Learning Records and evaluate baseline/candidate estimators, OLC, critical path, builder/workflow selection, calibration, and OOD behavior.

## Requirements

- [ ] All seven metrics use pinned denominators, missing-data rules, intervals, and confidence/OOD labels.
- [ ] Local state/history precedes matched community priors; no private query is sent.

## Implementation Steps

1. Pin redacted cohort schema, provenance, and snapshot version/signature.
2. Replay baseline and candidate policies with independent recomputation.
3. Record sparse-cohort, negative-case, marginal-capacity, and acceptance-calibration outcomes.

## Todo

- [ ] Replay/calibration receipt
- [ ] Independent recomputation receipt

## Success Criteria

- [ ] Forecasts expose assumptions, interval/confidence, critical path, useful lanes, and estimate-vs-actual.
- [ ] No result changes execution authority or protected gates.
