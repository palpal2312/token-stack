# 📋 Câu Hỏi #2: Đề Bài & Nguồn Dữ Liệu Công Khai

## 1. Thông Tin Câu Hỏi
- **Tiêu đề:** Câu Hỏi 2: Sửa Lỗi Database Connection Pool Leak (Chạy Test & Sinh Patch Diff)
- **Tóm tắt mục tiêu:** Chạy integration test, bắt lỗi rò rỉ kết nối khi query rỗng, sửa lỗi trong finally block và nén log test.
- **Yêu cầu / Prompt:** "Chạy test suite cho UserService: phát hiện lỗi connection pool leak khi query trả về 0 rows, hãy sửa lỗi sao cho toàn bộ 25 integration tests PASS và tạo patch Git Diff súc tích."

## 2. Nguồn Dữ Liệu Công Khai (Ground Truth)
- **GitHub Repository:** [gothinkster/node-express-realworld-example-app](https://github.com/gothinkster/node-express-realworld-example-app)
- **Phân loại dữ liệu:** RealWorld Backend Bug #104 (SWE-bench / GitHub Issues)
- **Dung lượng token thô:** 4,250 tokens
- **Lớp tối ưu hóa nòng cốt:** **L3: RTK (-54.7%) & L2: Caveman (-69.5%)**
