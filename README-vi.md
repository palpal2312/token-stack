# token-stack

Động cơ **Tối ưu hóa Token & Quản lý Ngữ cảnh Master 7 Tầng Hoàn Chỉnh** cho các công cụ AI Coding CLI (OpenAI Codex CLI, Claude Code, Cursor, Kimi, Antigravity).

[![Trạng Thái Benchmark](https://img.shields.io/badge/Benchmark-Gi%E1%BA%A3m%2095.9%25%20Tokens-brightgreen)](token-stack-benchmark-report.md)
[![Giấy Phép: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![English Docs](https://img.shields.io/badge/Docs-%F0%9F%87%AC%F0%9F%87%A7%20English%20Docs-blue)](README.md)

---

## 🌐 Chuyển Đổi Ngôn Ngữ (Language Navigation)
- [🇬🇧 English Version](README.md)
- [🇻🇳 Bản Tiếng Việt (Hiện tại)](README-vi.md)

---

## 🏗️ Sơ Đồ Kiến Trúc 7 Tầng Master

```text
+-------------------------------------------------------------------------------------------------------------+
|                                         THE 7-LAYER MASTER STACK                                            |
+-------------------------------------------------------------------------------------------------------------+
|  📍 [Tầng 0: Code Topology]       -> GRAPHIFY / GITNEXUS / CODEGRAPH (Cấu trúc AST, tìm kiếm 0 token)           |
|  ✍️  [Tầng 1: Code Reduction]      -> PONYTAIL (KISS, YAGNI, thư viện chuẩn, triệt tiêu boilerplate)             |
|  💬 [Tầng 2: Word Reduction]      -> CAVEMAN (Phản hồi kỹ thuật súc tích, sinh Git patch diff, không nói thừa) |
|  ⚡ [Tầng 3: CLI Output Filter]    -> RTK - Rust Token Killer (Lọc 60-90% log rác git/build/test)                |
|  🌐 [Tầng 4: Context Proxy]       -> HEADROOM PROXY (Nén ngữ cảnh HTTP lossless & tận dụng Prompt Caching)       |
+ - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - +
|  🧠 [Tầng 5: Knowledge Harvester] -> MEMORAX CODE (Tự động đúc kết kinh nghiệm & quy chuẩn vào bộ nhớ)           |
|                                             │                                                               |
|                                             ▼ (Đường ống chuyển giao dữ liệu)                               |
|  🗄️  [Tầng 6: Context Database]    -> OPENVIKING / OBSIDIAN VAULT (Kho lưu trữ phân tầng L0/L1/L2 tiết kiệm 91%)  |
|                                         ├── viking://knowledge (RAG phân cấp 3 tầng, tiết kiệm 91% tokens)   |
|                                         ├── viking://skills    (Kích hoạt skill động, không phình context)   |
|                                         └── viking://memory    (Bộ nhớ vĩnh viễn kế thừa từ MemoraX)        |
+-------------------------------------------------------------------------------------------------------------+
```

---

## 📊 Bảng Số Liệu Tổng Kết Thực Nghiệm & Đánh Giá Từng Tầng

Dựa trên kết quả đo lường đối chứng thực tế trên **5 bộ đề bài nguồn mở chuẩn từ GitHub** (Tổng 29.497 tokens gốc), bộ Token Stack 7 tầng đạt mức **giảm trung bình -95.9% lượng tokens tiêu thụ** (chỉ còn 1.203 tokens) trong khi nâng điểm chất lượng câu trả lời lên mức tuyệt đối **100/100 (+19 điểm so với bản thô)**:

### 🏆 Bảng Tổng Hợp 5 Bài Toán Benchmark Thực Tế:

| # | Bài Toán / Bộ Dữ Liệu | Nguồn Kiểm Chứng GitHub | Lớp Tỏa Sáng Nhất | Tokens Gốc | Tokens Sau Nén | Mức Giảm % | Điểm Chất Lượng | Chỉ Số CEI Index |
|:---:|:---|:---|:---|:---:|:---:|:---:|:---:|:---:|
| **1** | **Khảo sát Kiến trúc Repository** | [`hagopj13/node-express-boilerplate`](https://github.com/hagopj13/node-express-boilerplate) | **`L0: Graphify`** | 4.247 | **423** | **-90.0%** | **100/100** | **190.0 🏆** |
| **2** | **Sửa Lỗi Leak DB Pool (TDD Bugfix)** | [`gothinkster/node-express-realworld-example-app`](https://github.com/gothinkster/node-express-realworld-example-app) | **`L3: RTK` & `L2: Caveman`** | 4.250 | **210** | **-95.1%** | **100/100** | **195.1 🏆** |
| **3** | **Trích Xuất Quy Chuẩn Kiến Trúc Liên Phiên** | [`THUIR/MemoryBench`](https://github.com/THUIR/MemoryBench-LeaderBoard) | **`L5: MemoraX` & `L4: Headroom`** | 6.250 | **45** | **-99.3%** | **100/100** | **199.3 🏆** |
| **4** | **Chưng Cất Trạng Thái Gỡ Lỗi 8 Turns** | [`THUIR/MemoryBench`](https://github.com/THUIR/MemoryBench-LeaderBoard) | **`L6: OpenViking`** | 6.250 | **195** | **-96.9%** | **100/100** | **196.9 🏆** |
| **5** | **Backtest Chiến Thuật Quant Trên CSV** | [`kernc/backtesting.py`](https://github.com/kernc/backtesting.py) | **`L0: Graphify` & `L3: RTK`** | 8.500 | **330** | **-96.1%** | **100/100** | **196.1 🏆** |
| ★ | **TỔNG HỢP TOÀN BỘ 5 BÀI TOÁN** | **Bộ Đề Chuẩn GitHub Mở** | **Full 7 Tầng Token Stack** | **29.497** | **1.203** | **-95.9%** | **100/100** | **195.5 🏆** |

---

### 🎯 Tác Dụng & Trường Hợp Sử Dụng Từng Tầng (Layer Specialty Matrix):

| Tầng Layer | Công Cụ Đại Diện | Điểm Mạnh Cốt Lõi & Tác Dụng Thực Tế | Mức Giảm Tiêu Biểu | Khi Nào Nên Dùng |
|:---|:---|:---|:---:|:---|
| **`L0: Code Topology`** | **Graphify / GitNexus / CodeGraph** | Tỉa bỏ 95% files và symbols thừa nhờ xây dựng đồ thị phụ thuộc AST. | **-82% đến -91.5%** | Khi khảo sát repo mới, tìm kiếm kiến trúc toàn dự án, phân tích schema database. |
| **`L1: Code Reduction`** | **Ponytail** | Ép dùng thư viện chuẩn, chuẩn KISS & YAGNI; triệt tiêu code boilerplate và code thừa lặp lại. | **-3% đến -16.5%** | Khi sinh mới API endpoint, viết service logic, viết hàm tiện ích. |
| **`L2: Word Reduction`** | **Caveman** | Ép AI xuất Git Patch Diff siêu ngắn thay vì in lại toàn bộ file mã nguồn; cắt bỏ lời giải thích rườm rà. | **-48% đến -69.5%** | Khi sửa bug, refactor mã nguồn, tạo code patch, review mã. |
| **`L3: CLI Output Filter`** | **RTK (Rust Token Killer)** | Lọc sạch log rác terminal, bỏ qua các dòng test pass thành công và log đặt lệnh lặp lại. | **-54.7% đến -58.5%** | Khi chạy test suite (`npm test`, `pytest`, `cargo test`), build dự án, chạy backtest quant. |
| **`L4: Context Proxy`** | **Headroom** | Proxy HTTP lossless kích hoạt 90% chiết khấu Prompt Cache API trên các phiên làm việc dài. | **-82.7% đến -86.0%** | Khi hội thoại dài vượt quá 5.000+ context tokens. |
| **`L5: Knowledge Harvester`** | **MemoraX Code** | Tự động đúc kết quy chuẩn hệ thống (UUID, AppError) thành slot nhớ chỉ 45 tokens. | **-86% đến -99.3%** | Khi duy trì tính liên tục giữa các phiên làm việc, không phải nạp lại lịch sử cũ. |
| **`L6: Context Database`** | **OpenViking** | Chưng cất 8 vòng lặp gỡ lỗi thất bại thành 1 bản tóm tắt nguyên nhân gốc và giải pháp dứt điểm. | **-93.0% đến -96.9%** | Khi xử lý bug khó nhiều vòng lặp, đa subagent, hệ thống hội thoại phức tạp. |

---

### 🔬 Nghiên Cứu Triệt Tiêu (Leave-One-Out Ablation Study):

Chuyện gì sẽ xảy ra nếu tắt bớt từng tầng? Nghiên cứu Leave-One-Out đã đo lường chính xác mức độ thiệt hại khi thiếu vắng từng tầng:

1. ❌ **Tắt `L0: Graphify` (Bị phạt +15.684 tokens, hiệu quả nén tụt -53.2%):** Tầng quan trọng nhất khi đọc codebase. Thiếu L0, AI sẽ nạp toàn bộ file rác vào context.
2. ❌ **Tắt `L4: Headroom` (Bị phạt +5.025 tokens, hiệu quả nén tụt -17.0%):** Mất Prompt Cache khiến các phiên dài phải gửi lại toàn bộ lịch sử qua API mạng.
3. ❌ **Tắt `L6: OpenViking` (Bị phạt +2.530 tokens, hiệu quả nén tụt -8.6%):** Mất khả năng chưng cất khiến 8 vòng debug làm tràn ngập log lỗi trùng lặp.
4. ❌ **Tắt `L5: MemoraX` (Bị phạt +2.120 tokens, hiệu quả nén tụt -7.2%):** Mất slot nhớ khiến AI phải đọc lại hàng ngàn dòng chat cũ để nhớ quy ước UUID.
5. ❌ **Tắt `L2: Caveman` (Bị phạt +1.430 tokens, hiệu quả nén tụt -4.8%):** AI in lại toàn bộ file code thay vì xuất diff ngắn gọn.
6. ❌ **Tắt `L1: Ponytail` (Bị phạt +950 tokens, hiệu quả nén tụt -3.2%):** Mã nguồn bị chèn nhiều helper thừa và code boilerplate.
7. ❌ **Tắt `L3: RTK` (Bị phạt +555 tokens, hiệu quả nén tụt -1.9%):** Hàng trăm dòng log test xanh chiếm dụng context không cần thiết.

👉 Báo cáo chi tiết: [`token-stack-benchmark-report.md`](token-stack-benchmark-report.md)

---

## ⚡ Cài Đặt Nhanh (Quick Start)

Chạy script cài đặt tự động toàn bộ 7 tầng:

```powershell
# Chạy thử nghiệm kiểm tra trước (Dry-run)
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-token-stack.ps1

# Cài đặt chính thức cho profile chỉ định
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\install-token-stack.ps1 `
  -ProfileDirectory "$HOME\.claude" `
  -CodeTopology graphify `
  -Harvester memorax `
  -ContextDatabase openviking `
  -Apply
```

### Cài đặt từng tầng tùy chọn:
- **Tầng 0 (Code Topology)**: `.\scripts\install-code-graph.ps1 -Engine <graphify|gitnexus|codegraph|none> -Apply`
- **Tầng 5 (Knowledge Harvester)**: `.\scripts\install-memory-layer.ps1 -Provider <memorax|none> -Apply`
- **Tầng 6 (Context Database Platform)**: `.\scripts\install-context-platform.ps1 -Platform <openviking|obsidian|local|none> -Apply`

---

## 🧪 Chạy Bộ Đánh Giá Benchmark

Khởi động giao diện TUI 3 bước tương tác:

```bash
# Chạy giao diện TUI 3 bước (Tùy chọn tắt/bật layer, số lần chạy N)
node ./skills/token-stack-benchmark/scripts/benchmark-tui.cjs

# Chạy nghiên cứu triệt tiêu Leave-One-Out Ablation Study
node ./skills/token-stack-benchmark/scripts/benchmark-tui.cjs --ablation

# Chạy tự động lấy điểm trung bình 3 lần
node ./skills/token-stack-benchmark/scripts/benchmark-tui.cjs --non-interactive --runs 3
```

---

## 🩺 Kiểm Tra Sức Khỏe Hệ Thống (Health Check)

Kiểm tra kết nối và trạng thái của toàn bộ 7 tầng:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\skills\token-stack-health\scripts\token-stack-health.ps1
```

---

## 📚 Danh Mục Tài Liệu Chi Tiết
1. Phân Tích Chuyên Sâu Kiến Trúc: [`docs/architecture.md`](docs/architecture.md)
2. Hướng Dẫn Cài Đặt Đa Profile: [`docs/setup-guide.md`](docs/setup-guide.md)
3. Hướng Dẫn Thiết Lập OpenAI Codex CLI: [`docs/codex-setup-guide.md`](docs/codex-setup-guide.md)
4. Báo Cáo Thực Nghiệm Chi Tiết Toàn Diện: [`token-stack-benchmark-report.md`](token-stack-benchmark-report.md)
