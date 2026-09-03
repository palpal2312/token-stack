---
phase: 1
title: "Scoping & Threat Model Analysis"
status: pending
priority: P1
effort: "30m"
dependencies: []
---

# Phase 1: Scoping & Threat Model Analysis

## Overview
Xác định đầy đủ các failure mode dẫn tới tình trạng agent bị đứt kết nối hoặc hỏng trạng thái khi tự cài đặt Headroom, từ đó định hình các biên an toàn (safety guards).

## Requirements
- Liệt kê toàn bộ các tác nhân gây đứt kết nối LLM (RAM env injection, subshell termination, port collision, db lock).
- Thiết lập nguyên tắc bất biến (Invariants): **Zero In-flight Env Mutation** và **Mandatory Detached Process**.

## Architecture & Failure Modes
1. **Failure Mode 1: Sớm đổi `ANTHROPIC_BASE_URL` trong tiến trình hiện tại**:
   - Khi script chạy `export ANTHROPIC_BASE_URL=...` hoặc sửa trực tiếp runtime process env, lượt gọi API tiếp theo gửi tới proxy chưa kịp lắng nghe -> Lỗi socket -> Agent crash.
   - *Mitigation*: Chỉ ghi file cấu hình tĩnh (`.env`, `settings.json`), tuyệt đối không đụng vào `$env:` của session hiện tại.
2. **Failure Mode 2: Tiến trình Headroom chết theo CLI subshell**:
   - Agent dùng tool bash chạy `headroom proxy` -> Khi tool kết thúc, SIGTERM/SIGHUP giết tiến trình proxy.
   - *Mitigation*: Khởi chạy tách biệt (Windows: `Start-Process -WindowStyle Hidden`, Linux: `nohup ... disown`).
3. **Failure Mode 3: Tranh chấp Database SQLite**:
   - Nhiều profile cùng dùng chung default DB (`~/.codex/headroom-data/headroom.db`) -> Lock database làm instance thứ 2 crash âm thầm sau vài giây.
   - *Mitigation*: Bắt buộc mỗi agent profile sở hữu đường dẫn SQLite DB riêng biệt.

## Success Criteria
- [x] Hoàn thành tài liệu phân tích rủi ro và tiêu chuẩn kỹ thuật an toàn cho các phase tiếp theo.
