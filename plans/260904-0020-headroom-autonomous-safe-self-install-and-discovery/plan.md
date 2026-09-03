---
title: "Headroom Autonomous Safe Self-Install and Discovery"
description: "Cơ chế cho phép Agent tự cài đặt và tích hợp Headroom Proxy không bị đứt kết nối: dò quét socket/process thực tế, cấp port an toàn, ghi nhận registry độc lập, và trì hoãn kích hoạt sau khi restart."
status: pending
priority: P1
effort: "4h"
tags: [headroom, token-stack, port-allocator, process-discovery, safe-cutover, session-hook]
created: 2026-09-04
---

# Headroom Autonomous Safe Self-Install and Discovery Plan

## 1. Vấn Đề & Mục Tiêu

### Vấn đề gốc:
1. **Đứt kết nối (In-flight Disconnection)**: Khi agent tự cấu hình `ANTHROPIC_BASE_URL` trỏ vào Headroom ngay trong session hiện tại khi proxy chưa sẵn sàng -> session bị cắt đứt, mất kết nối API -> agent chết đứng giữa chừng.
2. **Subshell Termination**: Spawn proxy thông qua lệnh bash thông thường sẽ chết ngay khi subprocess/tool call kết thúc.
3. **Xung đột cổng và Database SQLite**: Nhiều agent profile cùng chạy nhưng không biết các port Headroom đang active trên máy -> va chạm cổng hoặc crash do SQLite lock trên file DB chung.

### Mục tiêu giải pháp:
- **Zero In-flight Interruption**: Mọi thao tác cấu hình chỉ ghi xuống đĩa (Staging Config); session hiện tại giữ nguyên kết nối với upstream cũ; chỉ kích hoạt route mới sau khi **RESTART** agent.
- **Active Discovery & Registry**: Tự động dò tìm tất cả process Headroom đang chạy trên hệ điều hành + kiểm tra socket liveness để không bao giờ cấp trùng cổng.
- **Centralized Registry & Note**: Ghi nhận minh bạch mọi agent, cổng đã cấp, DB path, upstream vào file cấu hình tập trung `token-stack.registry.json` và bảng tra cứu markdown.
- **Durable Lifecycle Hook**: Kích hoạt thông qua hook `SessionStart`, tự phục hồi proxy và kiểm tra `/readyz` trước turn đầu tiên của session mới.

---

## 2. Lộ Trình Triển Khai (Phases Roadmap)

| Phase | Tên Phase | Trọng Tâm Kỹ Thuật | Trạng Thái |
|:---|:---|:---|:---:|
| **Phase 01** | [Scoping & Threat Model Analysis](./phase-01-start.md) | Phân tích các điểm gãy kết nối, ràng buộc môi trường đa agent | Pending |
| **Phase 02** | [Live Socket and Process Discovery](./phase-02-live-socket-and-process-discovery.md) | Quét OS process Win32/Linux + thăm dò TCP socket liveness thực tế | Pending |
| **Phase 03** | [Centralized Port Registry & Staging Engine](./phase-03-centralized-port-registry-and-staging-engine.md) | Cập nhật registry tập trung + ghi staging config vào profile disk | Pending |
| **Phase 04** | [Delayed Restart Activation via SessionStart Hook](./phase-04-delayed-restart-activation-via-sessionstart-hook.md) | Đăng ký hook kiểm tra & kích hoạt proxy khi session mới mở | Pending |
| **Phase 05** | [E2E Safe Install and Recovery Verification](./phase-05-e2e-safe-install-and-recovery-verification.md) | Kiểm thử toàn trình: mô phỏng cài đặt tự động mà không đứt phiên | Pending |

---

## 3. Tiêu Chí Nghiệm Thu (Acceptance Criteria)

- [ ] Lệnh quét port phát hiện chính xác 100% các instance Headroom đang chạy và port thực tế của chúng trên OS.
- [ ] Cấp phát port mới an toàn trong dải `8787-9999`, không trùng cả trong registry lẫn socket thực tế.
- [ ] Agent tự cài đặt không bị ngắt kết nối LLM hiện tại (không set env runtime vào RAM session đang chạy).
- [ ] Cập nhật đồng bộ `token-stack.registry.json` và xuất file tra cứu `docs/headroom-ports.md`.
- [ ] Session sau khi restart tự động khởi chạy Headroom qua hook và kết nối thông suốt qua proxy.
