---
phase: 2
title: "Live Socket and Process Discovery"
status: pending
priority: P1
effort: "45m"
dependencies: ["phase-01-start.md"]
---

# Phase 2: Live Socket and Process Discovery

## Overview
Xây dựng module dò quét trực tiếp trên hệ điều hành để phát hiện tất cả các instance Headroom đang chạy thực tế, đọc tham số port từ command line tiến trình, và kiểm tra socket loopback để đảm bảo tính khả dụng tuyệt đối.

## Requirements
- **Process Inspection**: Quét Win32/CIM (hoặc `/proc` trên Unix) để tìm các tiến trình `headroom` hoặc Python wrapper của nó.
- **CommandLine Parser**: Trích xuất tham số `--port <number>` từ command-line thực tế đang chạy.
- **Live Socket Probing**: Sử dụng `System.Net.Sockets.TcpListener` để kiểm tra cổng nào đang thật sự LISTEN và cổng nào đang tự do trong dải `8787-9999`.
- **Health Verification**: Thử ping `/readyz` tới các port đang mở để phân biệt giữa Headroom Proxy đang hoạt động bình thường với các cổng bị chiếm dụng bởi phần mềm khác.

## Related Code Files
- Modify: `core/port-allocator.ps1`
- Create: `core/headroom-discovery.ps1`

## Implementation Steps
1. Xây dựng hàm `Get-RunningHeadroomProcesses`:
   - Lấy danh sách PID và CommandLine của tất cả process khớp với pattern `headroom(\.exe)? proxy`.
   - Regex extract `--port\s+(\d+)` và `--memory-db-path\s+([^\s]+)`.
2. Xây dựng hàm `Get-ActiveHeadroomPorts`:
   - Kết hợp kết quả từ `Get-RunningHeadroomProcesses` và quét TCP socket loopback.
   - Thăm dò HTTP endpoint `http://127.0.0.1:<port>/readyz` với timeout ngắn (1s).
3. Mở rộng `Find-FreeHeadroomPort`:
   - Tự động nạp danh sách port đang chạy thực tế vào `$ReservedPorts` cùng với các port trong file registry.

## Success Criteria
- [x] Hàm quét OS trả về chính xác danh sách port Headroom đang chạy và trạng thái health của chúng.
- [x] Không bao giờ trả về một cổng đang bị chiếm bởi một process khác dù cổng đó chưa được ghi vào registry.
