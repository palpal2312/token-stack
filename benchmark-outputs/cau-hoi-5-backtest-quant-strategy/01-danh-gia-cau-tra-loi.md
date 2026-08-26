# 📊 Đánh Giá Đo Lường Câu Trả Lời: Câu Hỏi #5

> **Tiêu đề:** Câu Hỏi 5: Backtest Chiến Thuật Giao Dịch SMA & RSI Trên File CSV Dữ Liệu Lịch Sử
> **Nguồn dữ liệu:** [kernc/backtesting.py](https://github.com/kernc/backtesting.py)

---

## 1️⃣ Bảng 1: Hiệu Quả Từng Lớp Độc Lập (Single Layer Isolated)

| Lớp Tối Ưu Hóa | Tokens Còn Lại | Delta SD Token (%) | Chất Lượng TL | Delta Chất Lượng TL | Hiệu Quả CEI | Ghi Chú |
| :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| **Chưa áp dụng (Raw Baseline)** | 8,500 tokens | **0.0%** | **80/100** | **0đ (Gốc)** | **80.0** | Gốc ban đầu (Code + 10,000 dòng CSV + Order logs) |
| **L0: Graphify** | 1,500 tokens | **-82.4%** | **90/100** | **+10đ** | **164.1** | ★ TỎA SÁNG (Trích xuất đúng Strategy AST) |
| **L1: Ponytail** | 7,100 tokens | **-16.5%** | **80/100** | **0đ** | **93.2** | Chống viết helper lặp |
| **L2: Caveman** | 2,720 tokens | **-68.0%** | **100/100** | **+20đ** | **168.0** | ★ TỎA SÁNG (Chỉ trả về dict stats súc tích) |
| **L3: RTK** | 3,680 tokens | **-56.7%** | **100/100** | **+20đ** | **156.7** | ★ TỎA SÁNG (Lọc 9,000 dòng order execution logs) |
| **L4: Headroom** | 8,500 tokens | **0.0%** | **80/100** | **0đ** | **80.0** | Không đổi |
| **L5: MemoraX** | 8,535 tokens | **+0.4%** | **100/100** | **+20đ** | **100.0** | ⚠️ Tăng nhẹ do thêm memory slot |
| **L6: OpenViking** | 8,525 tokens | **+0.3%** | **100/100** | **+20đ** | **100.0** | ⚠️ Tăng nhẹ do thêm prefix summary |

---

## 2️⃣ Bảng 2: Hiệu Quả Cộng Dồn Lũy Tiến Từng Tầng (L0 ➔ L6)

| Thứ Tự Nạp Từng Tầng Layer | Tokens Còn Lại | Biến Động Tầng (Delta) | Delta SD Token (%) | Tổng Giảm Lũy Tiến % | Chất Lượng TL | Delta Chất Lượng TL | Hiệu Quả CEI |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| **0. Chưa áp dụng (Gốc Raw Baseline)** | 8,500 tokens | --- | **---** | **0.0%** | **80/100** | **--- (Gốc)** | **80.0** |
| **+ L0: Graphify 🏆** | 1,500 tokens | Tiết kiệm 7,000 | **-82.4%** | **-82.4%** | **90/100** | **+10đ** | **164.1** |
| **+ L1: Ponytail ** | 1,250 tokens | Tiết kiệm 250 | **-16.7%** | **-85.3%** | **90/100** | **+0đ** | **166.8** |
| **+ L2: Caveman 🏆** | 650 tokens | Tiết kiệm 600 | **-48.0%** | **-92.4%** | **100/100** | **+10đ** | **192.4** |
| **+ L3: RTK 🏆** | 270 tokens | Tiết kiệm 380 | **-58.5%** | **-96.8%** | **100/100** | **+0đ** | **196.8** |
| **+ L4: Headroom [ĐÃ TẮT]** | 270 tokens | 0 (Bỏ qua) | **0.0%** | **-96.8%** | **100/100** | **+0đ (Giữ nguyên)** | **196.8** |
| **+ L5: MemoraX 🏆** | 305 tokens | Tăng +35 (Overhead) | **+13.0%** | **-96.4%** | **100/100** | **+0đ** | **196.4** |
| **+ L6: OpenViking 🏆** | 330 tokens | Tăng +25 (Overhead) | **+8.2%** | **-96.1%** | **100/100** | **+0đ** | **196.1** |

---

## 3️⃣ Bảng 3: Bảng Đánh Giá Đáp Án Dual Rubric

| Loại Tiêu Chí | Chi Tiết Tiêu Chí Trong Câu Trả Lời | Thang Điểm | Trạng Thái |
|:---:| :--- | :---: | :---: |
| **Core** | Parse CSV: Chuẩn hóa DatetimeIndex và các cột Open, High, Low, Close, Volume | 20đ | **✅ ĐẠT** |
| **Core** | Strategy Class: Kế thừa Strategy, init() tính SMA/RSI, next() bắt tín hiệu crossover | 20đ | **✅ ĐẠT** |
| **Core** | Backtest Engine: Khởi tạo Backtest(data, SmaRsiStrategy, cash=10000, commission=0.002) | 20đ | **✅ ĐẠT** |
| **Core** | Performance Metrics: Trích xuất 4 chỉ số Return %, Sharpe Ratio, Max Drawdown %, Win Rate % | 20đ | **✅ ĐẠT** |
| **Bonus** | Grid Optimization: Thiết lập bt.optimize(n_sma_fast=range(5,15), n_sma_slow=range(20,40), maximize="Sharpe Ratio") | +10đ | **🌟 ĐẠT THƯỞNG** |
| **Bonus** | Khuyến nghị phòng ngừa Lookahead Bias & Overfitting khi backtest trên in-sample data | +10đ | **🌟 ĐẠT THƯỞNG** |

> **💡 Tổng Kết Điểm Chất Lượng:** **100/100đ** (Chỉ số CEI: **196.1 🏆**)
> **Nhận định:** *"Khởi tạo và backtest chiến thuật hoàn hảo, lọc sạch 9.000 log lệnh mua bán, trích xuất bảng Sharpe/Drawdown chính xác 100%."*
