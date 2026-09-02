---
phase: 2
title: UI Controller Layout
status: completed
effort: medium
---

# Phase 2: UI Controller Layout

## Overview
Tiến hành chỉnh sửa giao diện chính (SenView) để "nhường đất" cho Right Panel. Khi có tín hiệu từ Context (ở Phase 1) rằng Right Panel cần mở, giao diện chat của Sen sẽ co lại và phần bên phải sẽ trượt ra (slide in) hiển thị đúng component theo `mode` được yêu cầu.

## Requirements
- Functional:
  - Khung chat chính (Center column) phải co giãn mượt mà khi Right Panel xuất hiện.
  - Right Panel hiển thị động (dynamic rendering) các View tương ứng với mode (Ví dụ: render `<KanbanView />` nếu mode là `kanban`).
- Non-functional: Giữ nguyên khả năng resize thủ công (drag resizer) nếu có, tích hợp animation trượt êm ái bằng framer-motion hoặc CSS transitions.

## Architecture
- **Inject Point:** `src/components/SenView.tsx` (hoặc `ChatTab`).
- Xoá bỏ local state `showRight` cũ, thay thế bằng `useAukerPanel()`.
- Tạo một Component trung gian (e.g. `RightPanelRenderer`) chứa Switch/Case để render các Widget.

## Related Code Files
- Modify: `src/components/SenView.tsx`
- Create: `src/components/RightPanelRenderer.tsx` (optional - hoặc nhúng trực tiếp)

## Implementation Steps
1. Import `useAukerPanel` vào `SenView.tsx`.
2. Thay thế logic render cột bên phải bằng data lấy từ Context (mode, data).
3. Switch case các component (MissionControl, Kanban, Dify, Memory) tuỳ thuộc vào state.mode.
4. Đảm bảo UI Responsive, nếu màn hình quá nhỏ thì hiển thị dạng overlay.

## Success Criteria
- [ ] Sen có thể mở được khung Kanban ở bên phải chỉ thông qua lệnh đổi State. (OPEN: historical plan dir; see roadmap track record)
- [ ] Giao diện hiển thị mượt mà không bị vỡ bố cục (layout break). (OPEN: historical plan dir; see roadmap track record)

## Risk Assessment
- Rủi ro: Render các component nặng (như Dify Config, Memory 3D Graph) trong Right Panel làm chậm khung chat chính.
- Giảm thiểu: Áp dụng React.lazy (Dynamic Import của Next.js) để chỉ load code của component khi Panel thực sự mở.
