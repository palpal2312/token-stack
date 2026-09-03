---
phase: 3
title: "Centralized Port Registry and Staging Engine"
status: pending
priority: P1
effort: "45m"
dependencies: ["phase-02-live-socket-and-process-discovery.md"]
---

# Phase 3: Centralized Port Registry and Staging Engine

## Overview
Xây dựng cơ chế đăng ký profile tập trung vào `token-stack.registry.json`, sinh note tra cứu markdown `docs/headroom-ports.md`, và ghi cấu hình staging xuống thư mục config của agent mà không làm xáo trộn runtime env hiện tại.

## Requirements
- **Atomic Registry Update**: Lưu thông tin profile (tên, agent type, config dir, allocated port, upstream, sqlite db path).
- **Human-Readable Note Export**: Tự động kết xuất file bảng tổng hợp `docs/headroom-ports.md` liệt kê danh sách agent nào đang sở hữu cổng nào và trạng thái live.
- **Disk-Only Staging**: Ghi các biến môi trường vào file `.env` hoặc file cấu hình của agent (ví dụ `~/.claude-<profile>/.env` hoặc `~/.codex/.env`) nhưng **KHÔNG** set vào biến môi trường của session hiện hành.

## Related Code Files
- Modify: `core/registry.ps1`
- Create: `docs/headroom-ports.md`
- Create: `scripts/stage-headroom-profile.ps1`

## Implementation Steps
1. Mở rộng `Register-TokenStackProfile` trong `core/registry.ps1`:
   - Tiếp nhận tên profile, config dir, upstream.
   - Gọi discovery ở Phase 2 để lấy port an toàn nhất.
   - Sinh đường dẫn DB riêng: `<config_dir>\headroom-data\headroom.db`.
   - Lưu vào `token-stack.registry.json`.
2. Xây dựng hàm `Export-HeadroomPortNote`:
   - Đọc registry + live status từ Phase 2.
   - Ghi đè hoặc cập nhật bảng markdown tại `docs/headroom-ports.md`.
3. Xây dựng hàm `Write-StagingEnv`:
   - Ghi file `.env` chứa `ANTHROPIC_BASE_URL=http://127.0.0.1:<port>`, `HEADROOM_PORT`, `HEADROOM_UPSTREAM`, `HEADROOM_DB_PATH`.
   - Không xuất `export` ra shell hiện tại.

## Success Criteria
- [x] Profile mới được lưu đầy đủ vào `token-stack.registry.json`.
- [x] Bảng tra cứu `docs/headroom-ports.md` phản ánh trung thực toàn bộ agent và port.
- [x] File `.env` trên đĩa có đầy đủ config nhưng biến môi trường của tiến trình agent hiện tại không thay đổi.
