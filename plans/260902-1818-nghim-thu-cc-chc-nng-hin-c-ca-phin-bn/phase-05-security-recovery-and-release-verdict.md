---
title: "Phase 5: Security, recovery, and release verdict"
phase: 5
status: done
priority: P1
effort: "4-6h"
dependencies: [3, 4]
---

# Phase 5: Security, recovery, and release verdict

## Overview

Đóng nghiệm thu bằng negative/security checks, triage defect và verdict phiên bản.
Không phát hành hoặc thay đổi policy; chỉ xác định có đủ bằng chứng để chấp nhận.

## Requirements

- [ ] Local-only/origin/auth/path traversal và command allowlist checks đạt.
- [ ] Protected marker, legacy rollback, token redaction và receipt integrity được kiểm tra.
- [ ] Mọi FAIL/BLOCKED có severity, owner, recheck trigger và disposition.

## Implementation Steps

1. Chạy negative cases trong protected-controls, API auth/origin, vault path, `/api/run` allowlist và Dify loopback/capacity tests.
2. Scan reports/fixtures/receipts để loại secret, capability, token, raw transcript và local-private paths.
3. Lập `reports/acceptance-verdict.md` với verdict, residual risks và follow-ups; phân biệt `ACCEPTED`, `ACCEPTED_WITH_BLOCKERS` và `REJECTED`.

## Todo

- [ ] Security and evidence hygiene report complete.
- [ ] Owner reviews final verdict and opens follow-up plan for real defects.

## Success Criteria

- [ ] Verdict reproducible from receipts and current commit.
- [ ] Không có unresolved P0/P1 functional/security failure bị che giấu.
- [ ] Release recommendation là ACCEPTED, ACCEPTED_WITH_BLOCKERS hoặc REJECTED.

## Risk Assessment

Unit PASS không chứng minh production readiness. Arbiter phải chạy lại mechanical
gates và coi unavailable evidence là BLOCKED, không suy diễn PASS.

## Acceptance Findings to Record

- Dify API dùng `/api/integrations/dify/**`; không giả định `/api/dify`.
- Settings write/read là proposed/fixture khi feature flag tắt; cần disposition riêng.
- `GET /api/goals` thiếu local-request guard; đây là contract/security finding cần owner và recheck trigger.
