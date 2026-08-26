# 📋 Câu Hỏi #3: Đề Bài & Nguồn Dữ Liệu Công Khai

## 1. Thông Tin Câu Hỏi
- **Tiêu đề:** Câu Hỏi 3: Trích Xuất Quy Chuẩn Kiến Trúc Liên Phiên (Cross-Session Memory Task)
- **Tóm tắt mục tiêu:** Truy xuất quy chuẩn khóa chính UUID và Exception Handler từ phiên làm việc trước mà không nạp lại toàn bộ lịch sử hội thoại.
- **Yêu cầu / Prompt:** "Ở phiên làm việc mới (Session 2), hãy cho biết quy chuẩn xử lý ngoại lệ (Error Handling) và chuẩn khóa chính của Database trong dự án là gì để viết tiếp module mới."

## 2. Nguồn Dữ Liệu Công Khai (Ground Truth)
- **GitHub Repository:** [THUIR/MemoryBench-LeaderBoard](https://github.com/THUIR/MemoryBench-LeaderBoard)
- **Phân loại dữ liệu:** task_Long-Short.json (Long interaction history -> Short exact recall)
- **Dung lượng token thô:** 6,250 tokens
- **Lớp tối ưu hóa nòng cốt:** **L5: MemoraX (-99.3%) & L4: Headroom (-86.0%)**
