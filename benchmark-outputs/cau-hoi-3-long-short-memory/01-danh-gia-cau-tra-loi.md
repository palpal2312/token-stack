# 📊 Đánh Giá Đo Lường Câu Trả Lời: Câu Hỏi #3

> **Tiêu đề:** Câu Hỏi 3: Trích Xuất Quy Chuẩn Kiến Trúc Liên Phiên (Cross-Session Memory Task)
> **Nguồn dữ liệu:** [THUIR/MemoryBench-LeaderBoard](https://github.com/THUIR/MemoryBench-LeaderBoard)

---

## 1️⃣ Bảng 1: Hiệu Quả Từng Lớp Độc Lập (Single Layer Isolated)

| Lớp Tối Ưu Hóa | Tokens Còn Lại | Delta SD Token (%) | Chất Lượng TL | Delta Chất Lượng TL | Hiệu Quả CEI | Ghi Chú |
| :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| **Chưa áp dụng (Raw Baseline)** | 6,250 tokens | **0.0%** | **75/100** | **0đ (Gốc)** | **75.0** | Gốc ban đầu (Dễ hallucinate do 6,250 tokens lịch sử) |
| **L0: Graphify** | 5,375 tokens | **-14.0%** | **75/100** | **0đ** | **85.5** | Hỗ trợ |
| **L1: Ponytail** | 5,800 tokens | **-7.2%** | **75/100** | **0đ** | **80.4** | Hỗ trợ |
| **L2: Caveman** | 6,200 tokens | **-0.8%** | **75/100** | **0đ** | **75.6** | Hỗ trợ |
| **L3: RTK** | 6,250 tokens | **0.0%** | **75/100** | **0đ** | **75.0** | Không đổi |
| **L4: Headroom** | 1,050 tokens | **-83.2%** | **85/100** | **+10đ** | **155.7** | ★ TỎA SÁNG (Prompt Cache Hit 90%) |
| **L5: MemoraX** | 45 tokens | **-99.3%** | **100/100** | **+25đ** | **199.3** | ★ TỎA SÁNG ÁP ĐẢO (Trích xuất đúng slot nhớ #104) |
| **L6: OpenViking** | 287 tokens | **-95.4%** | **100/100** | **+25đ** | **195.4** | Hỗ trợ |

---

## 2️⃣ Bảng 2: Hiệu Quả Cộng Dồn Lũy Tiến Từng Tầng (L0 ➔ L6)

| Thứ Tự Nạp Từng Tầng Layer | Tokens Còn Lại | Biến Động Tầng (Delta) | Delta SD Token (%) | Tổng Giảm Lũy Tiến % | Chất Lượng TL | Delta Chất Lượng TL | Hiệu Quả CEI |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| **0. Chưa áp dụng (Gốc Raw Baseline)** | 6,250 tokens | --- | **---** | **0.0%** | **75/100** | **--- (Gốc)** | **75.0** |
| **+ L0: Graphify 🏆** | 5,375 tokens | Tiết kiệm 875 | **-14.0%** | **-14.0%** | **75/100** | **+0đ** | **85.5** |
| **+ L1: Ponytail ** | 5,100 tokens | Tiết kiệm 275 | **-5.1%** | **-18.4%** | **75/100** | **+0đ** | **88.8** |
| **+ L2: Caveman 🏆** | 5,050 tokens | Tiết kiệm 50 | **-1.0%** | **-19.2%** | **75/100** | **+0đ** | **89.4** |
| **+ L3: RTK 🏆** | 5,050 tokens | 0 | **0.0%** | **-19.2%** | **75/100** | **+0đ** | **89.4** |
| **+ L4: Headroom [ĐÃ TẮT]** | 5,050 tokens | 0 (Bỏ qua) | **0.0%** | **-19.2%** | **75/100** | **+0đ (Giữ nguyên)** | **89.4** |
| **+ L5: MemoraX 🏆** | 4,220 tokens | Tiết kiệm 830 | **-94.9%** | **-32.5%** | **100/100** | **+25đ** | **132.5** |
| **+ L6: OpenViking 🏆** | 4,220 tokens | 0 | **0.0%** | **-32.5%** | **100/100** | **+0đ** | **132.5** |

---

## 3️⃣ Bảng 3: Bảng Đánh Giá Đáp Án Dual Rubric

| Loại Tiêu Chí | Chi Tiết Tiêu Chí Trong Câu Trả Lời | Thang Điểm | Trạng Thái |
|:---:| :--- | :---: | :---: |
| **Core** | Quy chuẩn Khóa Chính: Nhận diện chính xác UUID v4 (không dùng auto-increment id) | 40đ | **✅ ĐẠT** |
| **Core** | Quy chuẩn Error Handling: Sử dụng AppError(statusCode, errorCode, message) | 40đ | **✅ ĐẠT** |
| **Bonus** | Chỉ ra vị trí file định nghĩa AppError tại src/utils/AppError.ts | +10đ | **🌟 ĐẠT THƯỞNG** |
| **Bonus** | Khuyến nghị quy tắc mapping mã lỗi sang HTTP Status 400/401/403/404 | +10đ | **🌟 ĐẠT THƯỞNG** |

> **💡 Tổng Kết Điểm Chất Lượng:** **100/100đ** (Chỉ số CEI: **132.5 🏆**)
> **Nhận định:** *"Trích xuất đúng 100% thông tin quy chuẩn từ phiên cũ mà không cần nạp lại 6.250 tokens lịch sử."*
