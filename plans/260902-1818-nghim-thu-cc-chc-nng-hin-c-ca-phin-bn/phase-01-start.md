---
title: "Phase 1: Start"
phase: 1
status: done
priority: P1
effort: "3-4h"
dependencies: []
---

# Phase 1: Baseline capability inventory

## Overview

Chốt version/build identity, nhóm capability, owner và điều kiện môi trường trước
khi chạy acceptance. Kết quả là ma trận không bỏ sót nhưng không mở rộng scope
theo mọi route nội bộ.

## Requirements

- [ ] Ghi commit/version, Node/Go/Pester/Docker/Obsidian availability và active plan.
- [ ] Lập catalog route từ `src/app`, API contract từ `src/app/api`, map tới test/script hiện có.
- [ ] Phân loại dependency thiếu thành BLOCKED với recheck trigger.

## Implementation Steps

1. Đọc README/PDR/architecture/runbook và các plan chưa hoàn tất; phát hiện dependency với S20/S23/plateau.
2. Chốt ma trận capability: dashboard/navigation; agent profiles/chat; Sen canonical; orchestration/kanban; goals/journal/memory; Dify; backup/recovery; settings/integrations.
3. Tạo `reports/capability-matrix.md` với IDs, preconditions, evidence và disposition.

## Todo

- [ ] Capability matrix reviewed for scope and ownership.
- [ ] Baseline receipt records exact commit and unavailable prerequisites.

## Success Criteria

- [ ] Không còn capability trong README/docs mà không có dòng trong matrix.
- [ ] Không biến thiếu môi trường thành PASS.

## Risk Assessment

Route inventory có thể lớn hơn public product surface. Dùng README, module
registry và API contracts làm authority; route không có contract ghi NOT-IN-SCOPE.
