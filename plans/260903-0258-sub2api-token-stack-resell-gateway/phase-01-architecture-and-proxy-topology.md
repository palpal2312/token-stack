# Phase 1: Architecture & Proxy Topology Design

## 1. Mục tiêu
Thiết kế và triển khai cầu nối Proxy hai chiều (Dual-Bridge Proxy) giữa khách hàng, Token-Stack và Sub2API router:
- Khách hàng kết nối vào Gateway tại cổng chuẩn (ví dụ: `http://api.yourdomain.com/v1`).
- Gateway thực hiện xử lý Ingress (nhận diện cache, bảo vệ loop) trước khi chuyển vào Sub2API.
- Sub2API xác thực API Key của khách, kiểm tra số dư và chuyển tiếp sang Egress của Token-Stack để tối ưu hóa token trước khi gửi về Upstream.

## 2. Luồng Xử Lý Chi Tiết (Request/Response Pipeline)

```mermaid
sequenceDiagram
    autonumber
    actor Client as Khách hàng (Claude Code / Cursor)
    participant Ingress as Token-Stack Ingress (Port 8000)
    participant Sub2API as Sub2API Core (Port 9284)
    participant Egress as Token-Stack Egress (Port 8787)
    participant Upstream as Nhà cung cấp Upstream (Anthropic/OpenAI)

    Client->>Ingress: POST /v1/messages (API Key, Prompt, Context)
    Note over Ingress: Kiểm tra Layer -1 Semantic Cache
    alt Cache Hit (Trùng truy vấn)
        Ingress->>Sub2API: Gửi webhook trừ tiền định mức (Internal Billing)
        Ingress-->>Client: Trả về kết quả Cache ngay lập tức (<12ms, 0 Upstream Tokens)
    else Cache Miss
        Note over Ingress: Kiểm tra Layer 7 Loop Breaker & Layer 6 CoT
        Ingress->>Sub2API: Chuyển tiếp Request chuẩn
        Sub2API->>Sub2API: Xác thực API Key, Trừ tiền tài khoản, Chọn Upstream
        Sub2API->>Egress: Gửi request tới Headroom Proxy
        Note over Egress: Layer 8 Headroom căn chỉnh Cache Breakpoint & Nén HTTP
        Egress->>Upstream: Gửi Request tối ưu tới Anthropic/OpenAI
        Upstream-->>Egress: Trả về phản hồi + Header cache_read_input_tokens
        Egress-->>Sub2API: Forward Stream về Sub2API
        Sub2API-->>Client: Stream phản hồi về cho khách hàng
    end
```

## 3. Các File Cần Tạo / Chỉnh Sửa
- `gateway/ingress-proxy.cjs`: Reverse proxy Node.js / Bun siêu nhẹ chịu tải cao.
- `gateway/config.json`: Cấu hình định tuyến cổng, upstream Sub2API, và ngưỡng cache.
- `docker-compose.yml`: Khai báo dịch vụ Ingress, Sub2API, Redis, SQLite.

## 4. Kiểm Thử & Xác Thực
- Kiểm tra curl qua Ingress: `curl -X POST http://127.0.0.1:8000/v1/messages`
- Đo latency overhead: Phải nhỏ hơn 15ms cho các request thông thường.
