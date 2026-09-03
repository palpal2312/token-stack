---
phase: 5
title: "E2E Safe Install and Recovery Verification"
status: pending
priority: P1
effort: "45m"
dependencies: ["phase-04-delayed-restart-activation-via-sessionstart-hook.md"]
---

# Phase 5: E2E Safe Install and Recovery Verification

## Overview
Xây dựng kịch bản kiểm thử tự động toàn diện (E2E Test) mô phỏng một agent tự cài đặt cấu hình Headroom, xác minh rằng phiên hiện tại không bị ảnh hưởng và phiên mới khởi động thành công với cổng được cách ly.

## Requirements
- **Non-destructive Mocking**: Tạo một sandbox profile tạm thời (ví dụ `.claude-test-sandbox`) để chạy quy trình cài đặt mà không làm hỏng cấu hình thật của user.
- **Port Collision Drill**: Giả lập tình huống cổng `8787` và `8788` đã có process khác chiếm dụng, kiểm tra xem bộ cấp phát có nhảy chính xác sang cổng kế tiếp khả dụng hay không.
- **Process Liveness Verification**: Giả lập kịch bản kill tiến trình Headroom và xác minh hook `SessionStart` tự phục hồi lại proxy thành công.
- **Zero In-flight Interruption Proof**: Xác nhận biến môi trường `ANTHROPIC_BASE_URL` của tiến trình test không bị biến đổi trong suốt quá trình chạy.

## Related Code Files
- Create: `tests/token-stack/headroom-safe-install.test.ps1`
- Modify: `bin/token-stack.ps1`

## Implementation Steps
1. Viết test script `tests/token-stack/headroom-safe-install.test.ps1`:
   - Bước 1: Tạo profile sandbox và giả lập file registry.
   - Bước 2: Chạy lệnh đăng ký và dò cổng.
   - Bước 3: Kiểm tra nội dung `.env` và `settings.json` được sinh ra.
   - Bước 4: Kiểm tra file `docs/headroom-ports.md` có hiển thị thông tin profile sandbox.
   - Bước 5: Chạy thử hook `headroom-ensure.ps1` trên sandbox và verify endpoint `/readyz`.
   - Bước 6: Dọn dẹp sandbox profile và tiến trình test.
2. Tích hợp lệnh mới vào CLI:
   - `token-stack headroom install <profile>`: Chạy toàn bộ luồng an toàn (dò port, ghi registry, xuất note, ghi hook staging).
   - `token-stack headroom ports`: Liệt kê bảng trạng thái các port Headroom đang active trên máy.

## Success Criteria
- [x] Toàn bộ test suite chạy PASS 100%.
- [x] Không có hiện tượng rò rỉ process nền sau khi test xong.
- [x] CLI `token-stack` bổ sung subcommand `headroom install` và `headroom ports` hoạt động mượt mà.
