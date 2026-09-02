---
title: "Phase 4: Agent, orchestration, and durability workflows"
phase: 4
status: done
priority: P1
effort: "1d"
dependencies: [2, 3]
---

# Phase 4: Agent, orchestration, and durability workflows

## Overview

Xác nhận workflow lõi: agent execution/fallback, canonical Sen chat, Orca
slots/dispatch, orchestration state, và durability qua restart/backup/restore.

## Architecture

Kiểm tra theo event/receipt boundary: dispatch → worker → persisted receipt →
projection/UI; không nhận terminal idle làm completion. Durable stores inspect
qua copy-first/read-only tooling.

## Requirements

- [ ] Canonical chat persist-before-ack, replay/dedupe và legacy inert đúng.
- [ ] Slot/reconcile/dispatch state không silent interleave; fallback giữ ownership.
- [ ] Restart, snapshot, restore và invalid snapshot/lease fail closed.

## Implementation Steps

1. Chạy Sen, Orca/reconcile/slot QA và Go product/reconcile/scheduler suites.
2. Chạy controlled S10 drills và inspect SQLite qua copy-first procedure.
3. Thực hiện canary agent/orchestration/plan-goal flow với IDs cô lập; xác nhận receipts/idempotency.

## Todo

- [ ] Workflow receipts link each assertion to a contract/test.
- [ ] Durability and fallback observations use redacted IDs.

## Success Criteria

- [ ] Không có duplicate turn, stale-owner write, lost restore data hoặc false completion.
- [ ] Blocked provider paths có fallback/recheck owner.

## Risk Assessment

Live agents có side effects và quota. Dùng canary/session IDs, local fixture và
giới hạn thời gian; không gửi production prompt hoặc publish external artifact.
