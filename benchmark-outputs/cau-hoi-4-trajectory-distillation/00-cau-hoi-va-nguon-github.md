# 📋 Câu Hỏi #4: Đề Bài & Nguồn Dữ Liệu Công Khai

## 1. Thông Tin Câu Hỏi
- **Tiêu đề:** Câu Hỏi 4: Chưng Cất Trạng Thái Hội Thoại Gỡ Lỗi Qua 8 Vòng Lặp (Multi-Turn Trajectory)
- **Tóm tắt mục tiêu:** Tóm tắt 8 lượt gỡ lỗi thất bại liên tiếp thành 1 bản tổng hợp súc tích chỉ ra nguyên nhân gốc và giải pháp dứt điểm.
- **Yêu cầu / Prompt:** "Sau 8 lượt gỡ lỗi thử nghiệm thất bại (Optimistic lock gây timeout, Pessimistic lock gây deadlock), hãy tóm tắt trạng thái hiện tại và đưa ra giải pháp dứt điểm."

## 2. Nguồn Dữ Liệu Công Khai (Ground Truth)
- **GitHub Repository:** [THUIR/MemoryBench-LeaderBoard](https://github.com/THUIR/MemoryBench-LeaderBoard)
- **Phân loại dữ liệu:** task_Long-Long.json (Multi-turn trajectory state condensation)
- **Dung lượng token thô:** 6,250 tokens
- **Lớp tối ưu hóa nòng cốt:** **L6: OpenViking (-93.0% Trajectory Compaction)**
