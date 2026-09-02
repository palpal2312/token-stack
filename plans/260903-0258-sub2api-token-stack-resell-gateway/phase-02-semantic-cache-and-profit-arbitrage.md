# Phase 2: Multi-Tenant Semantic Cache & Profit Arbitrage Engine

## 1. Bản Chất Kinh Tế (Economics of Token Arbitrage)

Khi kinh doanh dịch vụ API Resell, nhà cung cấp thường bán token cho khách hàng theo giá niêm yết (hoặc chiết khấu 10-20% so với giá gốc).
Tuy nhiên, chi phí lớn nhất của nhà cung cấp là tiền trả cho các bên Upstream (Anthropic, OpenAI, MaaS).

**Chiến lược Arbitrage với Token-Stack**:
- **Trường hợp 1 (0-Token Cache Hit)**:
  - Khách hàng hoặc các Subagent gửi câu hỏi giống nhau (ví dụ: giải thích mã lỗi, câu hỏi định nghĩa kiến trúc, system prompt mặc định của Claude Code/Cursor).
  - Gateway nhận diện vector similarity $\ge 0.88$ qua **Layer -1 (SQLite/Redis Vector)**.
  - Gateway trả lời ngay lập tức (<12ms) không tốn 1 token nào của Upstream.
  - **Lợi nhuận**: 100% doanh thu lượt gọi đó là lợi nhuận ròng.
- **Trường hợp 2 (Prompt Caching Arbitrage)**:
  - Khách gửi 50,000 tokens context.
  - **Layer 8 (Headroom)** căn chỉnh đúng 4-block cache breakpoint của Anthropic.
  - Upstream tính tiền nhà cung cấp theo mức giá Cache Read (rẻ hơn 90%, từ $3.00/M xuống $0.30/M).
  - Nhà cung cấp thu của khách giá gốc $3.00/M (hoặc $2.50/M) và chỉ trả Upstream $0.30/M.
  - **Lợi nhuận**: Thu về $2.20/M token thặng dư.

## 2. Thiết Kế Kỹ Thuật (Multi-Tenant Cache Storage)
- **Engine**: SQLite với SQLite-VSS hoặc Redis Vector Search để phục vụ nhiều người dùng cùng lúc (Concurrency 1,000+ RPS).
- **Phân tách theo Tenant / Mode**:
  - `Global Cache`: Dành cho các câu hỏi tri thức chung, tài liệu open-source, system prompt mặc định.
  - `Private Cache`: Tách biệt theo `User_ID` để đảm bảo bảo mật mã nguồn riêng tư của từng khách hàng.
- **TTL & Invalidation**:
  - Thiết lập TTL 24 giờ cho các câu trả lời động và 7 ngày cho các quy chuẩn kiến trúc tĩnh.

## 3. Đồng Bộ Billing với Sub2API
- Khi có Cache Hit:
  - Gateway tạo một bản ghi giả lập Usage (Report Usage) gửi về API nội bộ của Sub2API để Sub2API trừ số dư của User bình thường, đảm bảo khách hàng nhìn thấy báo cáo token chuẩn trên Dashboard cá nhân.
