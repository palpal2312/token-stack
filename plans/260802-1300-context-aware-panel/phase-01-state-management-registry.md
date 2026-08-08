---
phase: 1
title: State Management & Context API
status: completed
effort: low
---

# Phase 1: State Management & Context API

## Overview
Dự án hiện tại không dùng thư viện quản trị state bên thứ 3 (như Zustand hay Redux). Để tuân thủ nguyên tắc KISS (Keep It Simple, Stupid) và YAGNI, chúng ta sẽ xây dựng một **React Context native (`SenPanelContext`)** nhẹ nhàng để quản lý trạng thái của Panel bên phải. Context này giúp Sen (hoặc bất kỳ component nào) ra lệnh mở/đóng và thay đổi nội dung (Mission Control, Kanban, Code Space, Dify, v.v.) từ bất cứ đâu trong hệ thống.

## Requirements
- Functional: 
  - Khai báo Context quản lý các trạng thái: `isOpen`, `mode` (kanban, dify, memory, config, v.v.), `data` (dữ liệu động).
  - Cung cấp các hàm dispatch: `setPanel()`, `closePanel()`, `togglePanel()`.
- Non-functional: Tối thiểu hoá re-render; chỉ bọc Context ở cấp độ phù hợp để không ảnh hưởng hiệu suất toàn trang.

## Architecture
- **Context Layer:** Tạo thư mục `src/lib/context` hoặc `src/context`.
- **Schema:**
  ```typescript
  type SenPanelMode = "closed" | "kanban" | "mission-control" | "memory" | "dify" | "cli-config" | "code-space";
  ```
- **Provider Wrapper:** Inject vào `src/components/Shell.tsx` hoặc `src/app/layout.tsx` (nếu cần state xuyên suốt các route) hoặc chỉ bọc ở `SenView.tsx`.

## Related Code Files
- Create: `src/context/SenPanelContext.tsx`
- Modify: `src/app/layout.tsx` (để wrap Provider)

## Implementation Steps
1. Khởi tạo file `SenPanelContext.tsx`.
2. Định nghĩa TypeScript Interfaces cho State và các Actions.
3. Cấu hình React Provider và custom hook `useAukerPanel()`.
4. Import và wrap `SenPanelProvider` vào `RootLayout` hoặc `Shell`.

## Success Criteria
- [ ] Context hoạt động trơn tru không lỗi.
- [ ] Hook `useAukerPanel` có thể được gọi từ bất kỳ component con nào để kiểm tra state hiện tại.

## Risk Assessment
- Rủi ro: Wrap Context quá cao (như RootLayout) có thể gây re-render diện rộng.
- Giảm thiểu: Tách nhỏ state hoặc bọc Context provider ngay bên trong Layout con thay vì Root (tuy nhiên với React 18+ Server/Client components thì cần cẩn thận khai báo `"use client"`).
