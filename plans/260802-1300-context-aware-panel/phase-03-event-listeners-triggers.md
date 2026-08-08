---
phase: 3
title: Event Listeners & AI Triggers (Zero-UI Mechanism)
status: completed
effort: medium
---

# Phase 3: Event Listeners & AI Triggers (Zero-UI Mechanism)

## Overview
Phase này hoàn thiện khả năng "Zero-UI" của hệ thống. Sen (thông qua luồng LLM/SSE) cần có cơ chế gửi lệnh kích hoạt (triggers) để tự động đổi Context State thay vì bắt người dùng tự click. Khi người dùng chat yêu cầu thông tin, LLM sẽ trả về text kèm theo các metadata hoặc function call (tool calls) để UI bắt lấy và tự đổi Right Panel.

## Requirements
- Functional: 
  - Trình duyệt/Client bắt được tín hiệu điều khiển (UI commands) từ luồng stream của Sen.
  - Tự động gọi `setPanel(mode)` khi bắt được lệnh.
- Non-functional: Quá trình chuyển đổi diễn ra tự nhiên, đồng thời với việc hiển thị tin nhắn chat (không bị gián đoạn hay chớp nháy).

## Architecture
- Bắt intercept các stream event (SSE) ở tầng Chat stream.
- Nếu LLM trả về các tag hoặc JSON (vd: `<command>open_kanban</command>`) hoặc dùng công cụ MCP chuyên trách UI, Client sẽ parse và trigger hook.

## Related Code Files
- Modify: Nơi xử lý parse Message Stream (e.g., `src/lib/dify/stream.ts` hoặc `src/components/SenView.tsx` hook `useChat`).
- Modify: Tool list của LLM (thêm công cụ `ui_controller` để Sen biết nó có quyền đóng mở màn hình).

## Implementation Steps
1. Xác định vị trí parse tin nhắn chat của Sen.
2. Viết hàm Regex hoặc JSON Parser để bắt các directive (vd: `[UI_ACTION:OPEN_DIFY]`).
3. Bind hàm parser này với `setPanel()` từ Context ở Phase 1.
4. Cập nhật System Prompt (hoặc Tool) cho Sen để hướng dẫn nó sử dụng các lệnh này tùy thuộc vào cuộc trò chuyện.

## Success Criteria
- [ ] Khi chat "Mở bảng Kanban lên", Sen hiểu và gửi kèm tín hiệu ẩn.
- [ ] Giao diện tự động bắt tín hiệu ẩn đó và trượt mở Kanban bên phải.
- [ ] Người dùng không cần đụng chuột.

## Risk Assessment
- Rủi ro: LLM bị ảo giác (hallucination) gọi sai tên mode hoặc liên tục gọi mở màn hình gây nhiễu UI.
- Giảm thiểu: Khai báo rất chặt chẽ danh sách Mode được hỗ trợ (enum) và chỉ cho phép kích hoạt khi có user intent rõ ràng.
