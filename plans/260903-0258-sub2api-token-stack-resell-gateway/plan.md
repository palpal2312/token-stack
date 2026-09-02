---
title: "Token-Stack Integration with Sub2API for Resell API Router Hosting"
status: pending
created: 2026-09-03
author: Antigravity Assistant & Systems Architect
tags: [token-stack, sub2api, api-resell, reverse-proxy, profit-arbitrage, semantic-cache, headroom]
---

# Token-Stack 3.2 + Sub2API: Resell Router Gateway Plan

## 1. Executive Summary & Value Proposition

Tích hợp **Token-Stack 3.2 (14-Layer Engine)** vào hạ tầng dịch vụ **Sub2API (API Router / Reseller Gateway)** là hoàn toàn khả thi và mang lại lợi thế cạnh tranh mang tính bước ngoặt cho nhà cung cấp dịch vụ API Resell:

1. **Siêu lợi nhuận Chênh lệch (Token Arbitrage)**:
   - Khách hàng trả tiền theo bảng giá niêm yết (Raw Tokens).
   - Hạ tầng Token-Stack áp dụng **Layer -1 (Semantic Cache)** và **Layer 8 (Headroom Prompt Cache)**: Các truy vấn trùng lặp hoặc turn lịch sử dài được phục vụ với giá **$0 hoặc giảm 90% chi phí upstream**, tạo biên lợi nhuận ròng (Gross Margin) lên tới **60% - 90%**.
2. **Bảo vệ Tài khoản Upstream & Chống Tràn Quota**:
   - **Layer 7 (Loop Breaker)**: Chặn đứng các khách hàng dùng bot/agent rơi vào vòng lặp lỗi tuần hoàn 15x làm cháy tài nguyên upstream.
   - **Layer 6 (CoT Governor)**: Ép trần suy luận ẩn (Thinking Tokens) cho các tác vụ vụn vặt, chống nghẽn slot concurrency của upstream.
   - **Layer 0 (Model Cascading)**: Cung cấp gói dịch vụ "Smart Route / Auto Tier" tự động chuyển mạch tác vụ nhẹ sang upstream giá rẻ.
3. **Chống 429 & Dự phòng Tức thì (<500ms Failover)**:
   - Thay vì trả mã lỗi 429 về cho khách làm hỏng trải nghiệm, Gateway tự động chuyển mạch vòng lặp sang tài khoản dự phòng tiếp theo trong pool.

---

## 2. Kiến Trúc Topo Tích Hợp (Hybrid Gateway Topology)

```text
[Khách hàng: Claude Code / Cursor / Codex CLI]
                     │
                     ▼ (API Requests: /v1/messages, /v1/chat/completions)
┌────────────────────────────────────────────────────────────────────────┐
│ TOKEN-STACK INGRESS GATEWAY (Port 8000 / Reverse Proxy)                │
├────────────────────────────────────────────────────────────────────────┤
│  ⚡ Layer -1: Semantic Cache (Vector N-Gram: Trả lời ngay nếu cache hit)│
│  🛡️  Layer 7:  Loop Breaker (Chặn vòng lặp retry vô tận của bot)       │
│  🧠 Layer 6:  CoT Governor (Kiểm soát token thinking theo loại task)   │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │ (Cache Miss & Validated Requests)
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│ SUB2API CORE ROUTER (Port 9284 / Golang or Python Core)                │
├────────────────────────────────────────────────────────────────────────┤
│  🔑 Quản lý User API Key & Phân quyền Tier                             │
│  💰 Trừ tiền số dư tài khoản theo số lượng Token khách gửi (Billing)   │
│  ⚖️ Cân bằng tải (Load Balancing) & Quản lý Pool tài khoản upstream     │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │ (Forwarding to Upstreams)
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│ TOKEN-STACK EGRESS & ARBITRAGE LAYER                                   │
├────────────────────────────────────────────────────────────────────────┤
│  🎯 Layer 0:   Model Cascading (Chuyển mạch task nhẹ sang upstream rẻ) │
│  🌐 Layer 8:   Headroom Proxy (Nén HTTP + Căn chỉnh Prompt Cache 90%)   │
│  ⚡ Layer 5:   Turn Folding (Đóng băng lịch sử cũ của khách hàng)      │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │ (Optimized & Cached HTTP Calls)
                                     ▼
           [Anthropic / OpenAI / MaaS Upstream Providers]
```

---

## 3. Lộ Trình Triển Khai Theo Giai Đoạn (Phases)

| Giai đoạn | Mục tiêu | Trọng tâm Kỹ thuật | File Tài liệu |
| :--- | :--- | :--- | :--- |
| **Phase 1** | **Thiết kế Topology & Proxy Bridge** | Xây dựng reverse-proxy middleware kết nối Ingress ➔ Sub2API ➔ Egress | [`phase-01-architecture-and-proxy-topology.md`](phase-01-architecture-and-proxy-topology.md) |
| **Phase 2** | **Semantic Cache & Cơ chế Arbitrage** | Triển khai Cache tầng dịch vụ (Multi-tenant SQLite/Redis) & Billing Hook | [`phase-02-semantic-cache-and-profit-arbitrage.md`](phase-02-semantic-cache-and-profit-arbitrage.md) |
| **Phase 3** | **CoT Governor & Loop Breaker Bảo vệ** | Thiết lập bộ lọc rate-limit chống bot phá hoại & ép trần reasoning tokens | [`phase-03-upstream-headroom-and-cot-governance.md`](phase-03-upstream-headroom-and-cot-governance.md) |
| **Phase 4** | **Đóng gói Docker Compose & Sub2API Hook** | Đóng gói stack thành `docker-compose.yml` chạy song song với Sub2API | [`phase-04-sub2api-docker-integration-and-billing-alignment.md`](phase-04-sub2api-docker-integration-and-billing-alignment.md) |
| **Phase 5** | **Benchmark Tải & Kiểm tra SLA Resell** | Đo đạc latency (<15ms overhead), tỷ lệ tiết kiệm upstream và doanh thu ròng | [`phase-05-e2e-benchmarking-and-resell-sla.md`](phase-05-e2e-benchmarking-and-resell-sla.md) |

---

## 4. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)
- [ ] Ingress Gateway chặn được tối thiểu 95% request trùng lặp và phản hồi dưới 15ms.
- [ ] Sub2API vẫn ghi nhận và trừ tiền chính xác theo số token thực tế của khách, không bị lỗi sai lệch số dư.
- [ ] Chi phí upstream thực tế giảm từ **40% đến 70%** nhờ Headroom Prompt Caching và Semantic Caching.
- [ ] Triển khai 1-click qua Docker Compose trên cùng máy chủ hoặc cụm máy chủ VPS.
