# Phase 3: Upstream Headroom, CoT Governance & Loop Protection

## 1. Bảo Vệ Quota và Tài Nguyên Upstream

Trong mô hình Resell API, rủi ro lớn nhất là **khách hàng vô tình hoặc cố ý lạm dụng tài nguyên**:
1. **Cháy Slot Concurrency do Extended Thinking**:
   - Khách gọi model có tính năng suy luận sâu (Claude 3.7 Sonnet Thinking / OpenAI o1/o3-mini) cho những việc vụn vặt.
   - Model sinh 8,000 thinking tokens trong 20 giây, chiếm giữ worker stream và đốt sạch hạn mức RPM/TPM của tài khoản Upstream.
   - **Giải pháp - Layer 6 CoT Governor**: Gateway tự động phân tích độ phức tạp của prompt khách gửi. Nếu prompt chỉ là sửa typo, git commit, format JSON: Tự động chèn header hoặc can thiệp tham số `thinking: { budget_tokens: 1024 }`, giải phóng worker nhanh gấp 5 lần.
2. **Infinite Retry Loop (Vòng Lặp Chết)**:
   - Các Agent lập trình tự động (Cursor/Cline/Aider) khi gặp lỗi biên dịch lặp đi lặp lại 15-20 lần sẽ liên tục gửi request trong hoảng loạn.
   - **Giải pháp - Layer 7 Loop Breaker**: Sử dụng hàm băm SHA256 sliding window kiểm tra 3 turn gần nhất. Nếu phát hiện prompt và mã lỗi lặp lại 3 lần không đổi: Gateway tự động cắt luồng và trả về chỉ dẫn: `"Circular loop detected. Please review error context before retrying."` giúp bảo vệ số dư của khách và bảo vệ quota của hệ thống.
3. **Sub-500ms Waterfall Failover**:
   - Khi tài khoản upstream Anthropic A trả mã `429 (Too Many Requests)` hoặc `529 (Overloaded)`:
   - Thay vì ném lỗi 429 về phía khách hàng làm gián đoạn IDE, Gateway lập tức chuyển mạch nội bộ sang tài khoản upstream Anthropic B hoặc Kimi-k3/Alibaba MaaS trong vòng chưa đầy 500ms.

## 2. Headroom Proxy & Prompt Cache Alignment
- Gateway chạy một instance Headroom Daemon kết nối trực tiếp với các Endpoint Upstream.
- Tự động duy trì cấu trúc system message và tools schema ổn định để tận dụng tối đa cơ chế **Anthropic Ephemeral 5-minute Prompt Caching**.
