---
name: token-stack-benchmark
description: Interactive 4-Step TUI for Token Stack Benchmarking with 7 layers (L0 CodeGraph, L1 Ponytail, L2 Caveman, L3 RTK, L4 Headroom, L5 Memory, L6 Distill). Features Space toggle on all layers L0-L6 and Left/Right Arrow switching for L0 (Graphify/GitNexus/CodeGraph), L5 (MemoraX/MemOS/claude-mem), and L6 (OpenViking/Mnemosyne).
user-invocable: true
---

# Token Stack Benchmark Suite (4-Step TUI Wizard)

Interactive terminal UI để đánh giá và đo lường tỷ lệ nén token qua **4 Bước chuẩn hóa** với **7 Lớp Layer Chuẩn (L0 ➔ L6)**:

## 🔄 Quy trình 4 Bước TUI

### 📋 Bước 1: Chọn Task Examples (Ví dụ tác vụ thực tế)
- Mặc định chọn sẵn **3 ví dụ** (hoặc người dùng tick/untick tùy ý bằng `[Space]`):
  1. `[✔] Debug & Fix Type Errors in Monorepo`
  2. `[✔] Run Full Test Suite & Fix Failing Tests`
  3. `[✔] Refactor Module & Perform Code Review`
  4. `[ ] Scaffold New REST API Endpoint & Schema`
  5. `[ ] Search Codebase & Git Blame Audit`
  6. `[ ] Deploy Build & Inspect Container Logs`
  7. `[ ] Full-Cycle Feature Development Pipeline`

### 🧩 Bước 2: Cấu hình 7 Lớp Layer (Bật/Tắt L0➔L6 bằng `[Space]`, Đổi Repo bằng `[← / →]`)
- **`L0: Code Graph`** — `[✔ ENABLED]` (Bấm `[Space]` để Bật/Tắt). Bấm `[←/→]` để chuyển giữa:
  * **`Graphify`** *(AST code graph & structural relationship pruning - ~79.7% isolated)*
  * **`GitNexus`** *(Git commit-aware repo graph & differential context index - ~77.5% isolated)*
  * **`CodeGraph`** *(Semantic symbols & call-graph dependency network - ~75.2% isolated)*
- **`L1: Ponytail`** — `[✔ ENABLED]` (Bấm `[Space]` để Bật/Tắt).
- **`L2: Caveman`** — `[✔ ENABLED]` (Bấm `[Space]` để Bật/Tắt).
- **`L3: RTK`** — `[✔ ENABLED]` (Bấm `[Space]` để Bật/Tắt).
- **`L4: Headroom`** — `[✔ ENABLED]` (Bấm `[Space]` để Bật/Tắt).
- **`L5: Memory Management`** — `[✔ ENABLED]`. Bấm `[Space]` để Bật/Tắt, bấm `[←/→]` để chuyển giữa:
  * **`MemoraX`** *(Hierarchical 3-tier episodic & semantic memory - ~73.1% isolated)*
  * **`MemOS`** *(OS-like memory paging & virtual memory slots - ~71.0% isolated)*
  * **`claude-mem`** *(Lightweight markdown / SQLite persistent memory - ~66.8% isolated)*
- **`L6: Autonomous Distillation`** — `[✔ ENABLED]`. Bấm `[Space]` để Bật/Tắt, bấm `[←/→]` để chuyển giữa:
  * **`OpenViking`** *(Autonomous multi-session trajectory distillation - ~74.6% isolated)*
  * **`Mnemosyne`** *(Deep cognitive memory consolidation & subagent context pruning - ~76.2% isolated)*

### ⏱️ Bước 3: Chọn số lần thử nghiệm (Iterations)
- Mặc định: **`1 lần`** (có thể dùng phím `[↑/↓]`, `[←/→]` hoặc gõ `1..20` để tăng số lần chạy lấy trung bình).

### 📊 Bước 4: Thống Kê Toàn Diện
1. **Single Layer Isolated Table**: Đo lường hiệu quả đơn lẻ của từng Repo trên nền Base.
2. **Progressive Cumulative Stack Table**: Có thêm cột **`Impact %`** (tỷ lệ nén so với bước liền trước) và **`Cumul %`** (tỷ lệ nén lũy tiến).
3. **Task Scenarios Summary Matrix**: Tổng hợp theo từng tác vụ.

---

## Cách chạy

```bash
node .agents/skills/token-stack-benchmark/scripts/benchmark-tui.cjs
```
Hoặc qua PowerShell:
```powershell
powershell -File .agents/skills/token-stack-benchmark/scripts/token-stack-benchmark.ps1
```
*(Trong Claude Code, gõ `/token-stack-benchmark`)*.
