# Phase 5: E2E Load Benchmarking, Resell SLA & Rollout Strategy

## 1. Mục tiêu Kiểm Thử Tải (Stress & Load Testing)

Đảm bảo hệ thống trung chuyển Gateway + Sub2API duy trì độ ổn định tuyệt đối dưới tải cao của nhiều khách hàng lập trình đồng thời:
- **Tải kiểm thử**: 500 RPS (Requests Per Second) đồng thời.
- **Latency Overhead**: Phải $< 15\text{ms}$ cho các request thông thường, và $< 5\text{ms}$ cho các request trúng Semantic Cache.
- **Tỷ lệ sống sót (Resilience)**: 100% khi mô phỏng Upstream gặp lỗi 429 hoặc 529.

## 2. Kịch Bản Kiểm Thử (Benchmark Test Suite)
1. **Test Case 1: Cache Hit Arbitrage Verification**:
   - Gửi 100 request giống hệt nhau từ 10 client khác nhau.
   - Kỳ vọng: 1 request đầu tiên gửi về Upstream, 99 request sau trả lời từ Cache tại 0 Upstream Tokens. Sub2API trừ tiền thành công cả 100 request.
2. **Test Case 2: CoT Budget Throttling under Concurrency**:
   - Gửi prompt yêu cầu sửa 1 lỗi typo kèm model thinking.
   - Kỳ vọng: Gateway ép trần budget 1024 tokens, thời gian phản hồi giảm từ 15s xuống 2s.
3. **Test Case 3: Loop Breaker Interception**:
   - Giả lập một client bị lỗi lặp 5 lần liên tiếp.
   - Kỳ vọng: Gateway chặn ở turn thứ 3, không gửi sang Sub2API, trả mã cảnh báo thân thiện cho client.
4. **Test Case 4: 429 Failover Speed**:
   - Giả lập upstream chính trả mã HTTP 429.
   - Kỳ vọng: Gateway tự động đổi sang upstream phụ trong vòng $< 500\text{ms}$, client không hề nhận thấy lỗi ngắt kết nối.

## 3. Lộ Trình Triển Khai Thực Tế (Phased Rollout)
1. **Tuần 1**: Triển khai thử nghiệm Ingress Proxy cho 10 khách hàng thân thiết (Alpha Testing).
2. **Tuần 2**: Bật Semantic Cache và Headroom Prompt Caching để đo đạc biên lợi nhuận thực tế.
3. **Tuần 3**: Mở rộng toàn bộ cho 100% traffic khách hàng, bật tính năng tự động Failover đa upstream.
