---
phase: 4
title: "Delayed Restart Activation via SessionStart Hook"
status: pending
priority: P1
effort: "45m"
dependencies: ["phase-03-centralized-port-registry-and-staging-engine.md"]
---

# Phase 4: Delayed Restart Activation via SessionStart Hook

## Overview
Thiết lập cơ chế kích hoạt an toàn bằng cách cấu hình hook `SessionStart` vào `settings.json` (hoặc `hooks.json` của Codex/Claude). Hook này sẽ chỉ chạy khi người dùng khởi động phiên mới (restart agent), đảm bảo proxy được bật ngầm và kiểm tra sức khỏe trước khi turn đầu tiên gửi request.

## Requirements
- **Declarative Hook Injection**: Thêm hook `SessionStart` vào file `settings.json` của agent profile mục tiêu.
- **Fast-path Bypass**: Script hook kiểm tra nếu proxy đã `/readyz` (200 OK) thì thoát ngay lập tức trong <10ms, không gây trễ khi mở session mới.
- **Auto-Revival on Restart**: Nếu proxy chưa chạy, hook tự động spawn `headroom proxy` với cờ ngầm (`Start-Process -WindowStyle Hidden`) và chờ tới khi `/readyz` phản hồi (tối đa 90s) trước khi chuyển quyền cho agent.

## Related Code Files
- Modify: `scripts/headroom-ensure.ps1`
- Modify: `scripts/headroom-ensure.sh`
- Create: `core/hook-injector.ps1`

## Implementation Steps
1. Tối ưu hóa `scripts/headroom-ensure.ps1` để đọc cấu hình trực tiếp từ `.env` của profile hoặc fallback về registry.
2. Xây dựng hàm `Inject-SessionStartHook`:
   - Đọc file `settings.json` (cho Claude Code) hoặc `hooks.json` (cho Codex).
   - Kiểm tra xem hook `headroom-ensure` đã tồn tại chưa.
   - Thêm định nghĩa hook an toàn không ghi đè các hook khác đang có của user:
     ```json
     {
       "matcher": "startup|resume|clear|compact",
       "hooks": [
         {
           "type": "command",
           "command": "powershell -NoProfile -ExecutionPolicy Bypass -File \"<path>\\scripts\\headroom-ensure.ps1\"",
           "timeout": 120
         }
       ]
     }
     ```
3. Đảm bảo toàn bộ thao tác chỉ ghi xuống file cấu hình, không can thiệp vào bộ nhớ tạm.

## Success Criteria
- [x] Hook `SessionStart` được ghi chính xác vào cấu hình agent mà không làm mất các hook hiện có.
- [x] Trong phiên hiện tại, agent tiếp tục chạy bình thường với kết nối cũ.
- [x] Khi khởi động phiên mới, hook kích hoạt và đảm bảo proxy sẵn sàng trước khi gọi model.
