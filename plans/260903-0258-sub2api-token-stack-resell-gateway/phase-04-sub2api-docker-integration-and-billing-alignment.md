# Phase 4: Sub2API Docker Integration & Billing Alignment

## 1. Kiến Trúc Triển Khai Docker Compose

Đóng gói toàn bộ hệ sinh thái thành một file `docker-compose.yml` tiêu chuẩn để triển khai trên bất kỳ máy chủ Linux VPS / Cloud nào chỉ bằng 1 câu lệnh:

```yaml
version: '3.8'

services:
  token-stack-gateway:
    image: node:20-alpine
    container_name: token-stack-gateway
    restart: always
    working_dir: /app
    volumes:
      - ./gateway:/app
      - token_stack_cache:/root/.token-stack
    ports:
      - "8000:8000"
    environment:
      - SUB2API_UPSTREAM=http://sub2api:9284
      - HEADROOM_UPSTREAM=http://headroom:8787
      - CACHE_THRESHOLD=0.88
      - REDIS_URL=redis://redis:6379
    depends_on:
      - sub2api
      - redis
      - headroom

  sub2api:
    image: ghcr.io/sub2api/sub2api:latest # Hoặc container build hiện tại của bạn
    container_name: sub2api-core
    restart: always
    ports:
      - "9284:9284"
    volumes:
      - sub2api_data:/data
    environment:
      - PORT=9284
      - DATABASE_URL=sqlite:///data/sub2api.db
      - UPSTREAM_PROXY=http://headroom:8787
    depends_on:
      - headroom

  headroom:
    image: ghcr.io/headroom/headroom:latest # Hoặc binary headroom daemon
    container_name: token-stack-headroom
    restart: always
    ports:
      - "8787:8787"
    environment:
      - PORT=8787
      - UPSTREAM_ANTHROPIC=https://api.anthropic.com
      - UPSTREAM_OPENAI=https://api.openai.com

  redis:
    image: redis:7-alpine
    container_name: token-stack-redis
    restart: always
    volumes:
      - redis_data:/data

volumes:
  token_stack_cache:
  sub2api_data:
  redis_data:
```

## 2. Đồng Bộ Hóa Dữ Liệu Billing & Người Dùng

1. **Khách hàng kết nối**:
   - URL: `https://api.resell-domain.com` (Trỏ về Ingress port 8000).
   - API Key: Key do Sub2API phát hành (`sk-sub2api-...`).
2. **Xác thực và Trừ tiền**:
   - Ingress chuyển API Key tới Sub2API để kiểm tra tính hợp lệ và số dư.
   - Khi có phản hồi stream từ Upstream: Token usage được Sub2API ghi nhận và trừ tiền chính xác vào ví của khách.
   - Lợi nhuận chênh lệch (từ Cache hoặc Headroom 90% Prompt discount) được ghi nhận vào bảng thống kê lợi nhuận nội bộ của Admin.
