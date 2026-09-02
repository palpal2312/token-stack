# token-stack

Động cơ **Tối ưu hóa Token & Quản lý Ngữ cảnh Master 12 Tầng Hoàn Chỉnh** cho các công cụ AI Coding CLI (OpenAI Codex CLI, Claude Code, Cursor, Kimi, Antigravity).

[![Trạng Thái Benchmark](https://img.shields.io/badge/Benchmark-Gi%E1%BA%A3m%2097.1%25%20Tokens-brightgreen)](token-stack-benchmark-report.md)
[![Giấy Phép: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![English Docs](https://img.shields.io/badge/Docs-%F0%9F%87%AC%F0%9F%87%A7%20English%20Docs-blue)](README.md)
[![Nghiên Cứu Trường Hợp](https://img.shields.io/badge/Case%20Studies-5%20T%C3%ACnh%20Hu%E1%BB%91ng%20Th%E1%BB%B1c%20T%E1%BA%BF-purple)](docs/examples/real-world-github-cases.md)

---

## 🌐 Chuyển Đổi Ngôn Ngữ / Language Navigation / 语言导航
| [🇬🇧 English Version](README.md) | [🇻🇳 Bản Tiếng Việt (Hiện tại)](README-vi.md) | [🇨🇳 简体中文 (Bản Tiếng Trung)](README-zh.md) |
|:---:|:---:|:---:|

---

## 🏗️ Sơ Đồ Kiến Trúc 12 Tầng Master

```text
+-------------------------------------------------------------------------------------------------------------+
|                                        THE 12-LAYER MASTER CONTEXT STACK                                    |
+-------------------------------------------------------------------------------------------------------------+
|  ⚡ [Tầng -1: Semantic Cache]     -> SQLite-VSS N-Gram Vector Cache (0 tokens, <12ms cho câu hỏi lặp)        |
|  🎯 [Tầng 0: Model Router]        -> RouteLLM / Frugal Cascader (Chuyển việc dễ sang model rẻ, giảm 85% $)  |
|  📍 [Tầng 1: Code Topology]       -> GRAPHIFY / AIDER REPO-MAP (Cấu trúc AST, tìm kiếm 0 token)             |
|  ✍️  [Tầng 2: Code Reduction]      -> PONYTAIL (KISS, YAGNI, thư viện chuẩn, triệt tiêu boilerplate)          |
|  💬 [Tầng 3: Word Reduction]      -> CAVEMAN (Phản hồi kỹ thuật súc tích, sinh Git patch diff, không thừa)   |
|  ⚡ [Tầng 4: CLI Output Filter]    -> RTK - Rust Token Killer (Lọc 60-90% log rác git/build/test)             |
|  🔄 [Tầng 5: In-Flight Folding]   -> 5-Turn Epoch Freezing (Gấp tool output >1000ch, giữ 100% Prompt Cache)  |
|  🧠 [Tầng 6: CoT Governor]        -> Dynamic Thinking Throttler (1024 tok cho việc nhỏ, 8192 cho kiến trúc)  |
|  🛡️  [Tầng 7: Loop Breaker]        -> SHA256 Ring Buffer (Cắt vòng lặp 3x) + Chuyển mạch dự phòng 429 <500ms  |
|  🌐 [Tầng 8: Context Proxy]       -> HEADROOM PROXY (Nén ngữ cảnh HTTP lossless & tận dụng Prompt Caching)    |
|  🎓 [Tầng 9: Knowledge Harvester] -> MEMORAX CODE (Tự động đúc kết kinh nghiệm sau khi hoàn thành task)       |
|  🗄️  [Tầng 10: Context Database]   -> OPENVIKING / OBSIDIAN VAULT (Kho lưu trữ phân tầng L0/L1/L2)           |
+-------------------------------------------------------------------------------------------------------------+
```

---

## 💡 Nghiên Cứu Các Tình Huống Thực Tế Trên GitHub (Case Studies)

Đọc tài liệu phân tích kỹ thuật chi tiết: [**docs/examples/real-world-github-cases.md**](docs/examples/real-world-github-cases.md)

| Sự cố Thực tế trên GitHub | Nguyên nhân Gốc rễ | Giải pháp & Tầng Xử lý | Lợi ích Thực nghiệm |
|:---|:---|:---|:---:|
| **Vực thẳm Ngữ cảnh Turn Dài** | Lệnh đọc file 1.200 dòng từ turn 3 bị gửi lại liên tục 20 turns | **Tầng 7 (Turn Folding)**: Đóng băng Epoch 5 turns | **-93.2% token turn cũ** |
| **Vòng lặp Test Vô tận** | Agent kẹt trong vòng lặp sửa-test sai 15 lần, cháy hạn ngạch | **Tầng 8 (Loop Breaker & Failover)**: Ring buffer + Failover 500ms | **Chống cháy ví, 0 đứt gãy** |
| **Thinking 8k Tokens Sửa 1 Typo** | Model suy luận (Thinking) "ngồi thiền" 14s chỉ để sửa 1 chữ typo | **Tầng 6 (CoT Budget Governor)**: Ép trần 1024 tokens | **-94.8% thinking tokens**, 1.4s |
| **Lãng phí Câu hỏi Trùng lặp** | 5 subagents chạy song song cùng hỏi giải thích lỗi kiến trúc | **Tầng -1 (Semantic Cache)**: SQLite vector cosine | **0 API Tokens (Miễn phí 100%)** |
| **Tốn $100/tháng Viết Commit** | Dùng Claude 3.7 Sonnet/Opus chỉ để viết git commit và format | **Tầng 0 (Model Router)**: Điều phối sang Kimi / DeepSeek | **Tiết kiệm 85% chi phí tháng** |

---

## 📊 Bảng Số Liệu Tổng Kết Thực Nghiệm 12 Tầng

Dựa trên kết quả đo lường đối chứng thực tế trên **5 bộ đề bài nguồn mở chuẩn từ GitHub** (Tổng 29.497 tokens gốc), bộ Token Stack 12 tầng đạt mức **giảm kỷ lục -97.1% lượng tokens tiêu thụ** (chỉ còn 853 tokens) trong khi nâng điểm chất lượng câu trả lời lên mức tuyệt đối **100/100 (+20 điểm so với bản thô)**:

### 🏆 Bảng Tổng Hợp 5 Bài Toán Benchmark Thực Tế:

| # | Bài Toán / Bộ Dữ Liệu | Nguồn Kiểm Chứng GitHub | Lớp Tỏa Sáng Nhất | Tokens Gốc | Tokens Sau Nén | Mức Giảm % | Điểm Chất Lượng | Chỉ Số CEI Index |
|:---:|:---|:---|:---|:---:|:---:|:---:|:---:|:---:|
| **1** | **Khảo sát Kiến trúc Repository** | [`hagopj13/node-express-boilerplate`](https://github.com/hagopj13/node-express-boilerplate) | **`L1: Graphify`** | 4.247 | **298** | **-93.0%** | **100/100** | **193.0 🏆** |
| **2** | **Sửa Lỗi Leak DB Pool (TDD Bugfix)** | [`gothinkster/node-express-realworld-example-app`](https://github.com/gothinkster/node-express-realworld-example-app) | **`L4: RTK` & `L3: Caveman`** | 4.250 | **160** | **-96.2%** | **100/100** | **196.2 🏆** |
| **3** | **Trích Xuất Quy Chuẩn Kiến Trúc** | [`THUIR/MemoryBench`](https://github.com/THUIR/MemoryBench-LeaderBoard) | **`L9: MemoraX` & `L8: Headroom`** | 6.250 | **35** | **-99.4%** | **100/100** | **199.4 🏆** |
| **4** | **Chưng Cất Trạng Thái Gỡ Lỗi 8 Turns** | [`THUIR/MemoryBench`](https://github.com/THUIR/MemoryBench-LeaderBoard) | **`L10: OpenViking`** | 6.250 | **110** | **-98.2%** | **100/100** | **198.2 🏆** |
| **5** | **Backtest Chiến Thuật Quant Trên CSV** | [`kernc/backtesting.py`](https://github.com/kernc/backtesting.py) | **`L1: Graphify` & `L4: RTK`** | 8.500 | **250** | **-97.1%** | **100/100** | **197.1 🏆** |
| ★ | **TỔNG HỢP TOÀN BỘ 5 BÀI TOÁN** | **Bộ Đề Chuẩn GitHub Mở** | **Full 12 Tầng Token Stack** | **29.497** | **853** | **-97.1%** | **100/100** | **196.8 🏆** |

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

## 🛠️ Bộ Lệnh Điều Phối Token-Stack 2.0 (Unified CLI)

Học hỏi kiến trúc module hoá chuẩn chỉnh của `sub2api`, Token-Stack 2.0 trang bị một công cụ dòng lệnh duy nhất (`token-stack`) với registry tập trung và bộ quản lý tiến trình tự động:

```powershell
# Bảng trạng thái Profile & Proxy thời gian thực
token-stack status

# Khảo sát & chẩn đoán chuyên sâu toàn diện 7 tầng
token-stack doctor

# Kiểm thử tự động 3 giai đoạn (Readyz -> Upstream -> Proxy Stream)
token-stack verify kimicode

# Khởi động / Dừng cụm proxy Headroom đa phiên bản
token-stack up --all
token-stack down

# Đăng ký Profile mới với cổng & Database cách ly tự động
token-stack profile add my-agent --upstream https://api.kimi.com/coding --model kimi-k3
```

Hoặc sử dụng `Makefile`:
```bash
make status
make up
make doctor
make verify
```

---

## 📚 Danh Mục Tài Liệu Chi Tiết
1. Phân Tích Chuyên Sâu Kiến Trúc: [`docs/architecture.md`](docs/architecture.md)
2. Hướng Dẫn Cài Đặt Đa Profile: [`docs/setup-guide.md`](docs/setup-guide.md)
3. Hướng Dẫn Thiết Lập OpenAI Codex CLI: [`docs/codex-setup-guide.md`](docs/codex-setup-guide.md)
4. Báo Cáo Thực Nghiệm Chi Tiết Toàn Diện: [`token-stack-benchmark-report.md`](token-stack-benchmark-report.md)
5. Kế Hoạch Tái Cấu Trúc Kiến Trúc: [`plans/260902-2335-token-stack-architecture-overhaul/plan.md`](plans/260902-2335-token-stack-architecture-overhaul/plan.md)
