# 📋 Câu Hỏi #5: Đề Bài & Nguồn Dữ Liệu Công Khai

## 1. Thông Tin Câu Hỏi
- **Tiêu đề:** Câu Hỏi 5: Backtest Chiến Thuật Giao Dịch SMA & RSI Trên File CSV Dữ Liệu Lịch Sử
- **Tóm tắt mục tiêu:** Nạp file CSV nến OHLCV, thiết lập chiến thuật SMA Crossover kết hợp lọc RSI, chạy Backtest và tối ưu hóa tham số bằng backtesting.py.
- **Yêu cầu / Prompt:** "Hãy viết mã Python nạp dữ liệu nến OHLCV từ file CSV (BTCUSDT_1h.csv), thiết lập chiến thuật giao dịch SMA Crossover (MA 10/20) kết hợp bộ lọc RSI (RSI < 70), chạy Backtest bằng thư viện backtesting.py, trích xuất các chỉ số định lượng trọng yếu (Return %, Sharpe Ratio, Max Drawdown %, Win Rate %) và tối ưu hóa tham số."

## 2. Nguồn Dữ Liệu Công Khai (Ground Truth)
- **GitHub Repository:** [kernc/backtesting.py](https://github.com/kernc/backtesting.py)
- **Phân loại dữ liệu:** Financial Quant Dataset (OHLCV Historical 1h Candles CSV + backtesting.py engine)
- **Dung lượng token thô:** 8,500 tokens
- **Lớp tối ưu hóa nòng cốt:** **L0: Graphify (-82.4%) & L3: RTK (-56.7%) & L2: Caveman (-68.0%)**
