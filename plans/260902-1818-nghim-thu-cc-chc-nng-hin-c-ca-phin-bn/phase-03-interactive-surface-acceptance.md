---
title: "Phase 3: Interactive surface acceptance"
phase: 3
status: done
priority: P1
effort: "1d"
dependencies: [2]
---

# Phase 3: Interactive surface acceptance

## Overview

Nghiệm thu smoke/UAT theo nhóm surface có người dùng: navigation, agent chat,
orchestration, goals/journal/memory, settings/integrations và các API public.

## Architecture

Browser smoke dùng app local và route catalog; API checks dùng loopback request,
assert status/schema/error envelope. Evidence chỉ chứa IDs đã redacted.

## Requirements

- [ ] Happy path và empty/error state của từng capability group hoạt động.
- [ ] Navigation không trỏ tới 404; loading/retry/disabled state rõ ràng.
- [ ] Public response shape, status codes và local-origin/auth boundary đúng contract.

## Implementation Steps

1. Chạy các QA tests hiện có trong `qa/tests/` (shell, Sen, Orca, Dify) và bổ sung manual checklist cho route chưa tự động hóa.
2. Smoke toàn bộ 62 page routes; route `/journal` phải được ghi là route-gap (không tự coi 404 là môi trường blocker). Nhóm public/lõi gồm `/`, `/agents`, `/builders`, `/sen`, `/orchestration`, `/agent-kanban`, `/goals`, `/memory`, `/dify`, `/settings` cùng route agent được cấu hình.
3. Kiểm tra API theo capability family, dùng namespace Dify thật `/api/integrations/dify/**`; xác nhận 4xx/5xx deterministic và không leak nội dung nhạy cảm.

## Todo

- [ ] Surface matrix has PASS/FAIL/BLOCKED per group.
- [ ] Browser/API artifacts are redacted and linked from report.

## Success Criteria

- [ ] Không có blocker trong critical navigation/chat/orchestration flow.
- [ ] Agent thiếu CLI được ghi NOT-INSTALLED/BLOCKED, không coi là product PASS.

## Risk Assessment

CLI/provider availability và browser permissions có thể chặn flow chat. Tách
product failure khỏi environment blocker bằng preflight và route health evidence.

## Acceptance Findings to Record

- `/journal` page chưa tồn tại: FAIL/route gap nếu được coi là public surface.
- `/settings` hiện là fixture/proposed endpoint: không đánh dấu production persistence PASS.
- `GET /api/goals` chưa có `checkLocalRequest`: kiểm tra và ghi nhận contract gap.
