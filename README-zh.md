# token-stack

适用于 AI 编程命令行工具（OpenAI Codex CLI、Claude Code、Cursor、Kimi、Antigravity）的**完整 7 层 Token 与上下文主控优化引擎**。

[![基准测试状态](https://img.shields.io/badge/Benchmark-%E9%99%8D%E4%BD%8E%2095.9%25%20Token-brightgreen)](token-stack-benchmark-report.md)
[![开源许可证: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![English Docs](https://img.shields.io/badge/Docs-%F0%9F%87%AC%F0%9F%87%A7%20English%20Docs-blue)](README.md)
[![Vietnamese Docs](https://img.shields.io/badge/Docs-%F0%9F%87%BB%F0%9F%87%B3%20Ti%E1%BA%BFng%20Vi%E1%BB%87t-red)](README-vi.md)

---

## 🌐 语言导航 / Language Navigation / Chuyển Đổi Ngôn Ngữ
| [🇬🇧 English (英文)](README.md) | [🇻🇳 Tiếng Việt (越南语)](README-vi.md) | [🇨🇳 简体中文 (当前)](README-zh.md) |
|:---:|:---:|:---:|

---

## 🏗️ 7 层主架构 (The 7-Layer Master Stack)

```text
+-------------------------------------------------------------------------------------------------------------+
|                                         7 层 Token 与上下文主控优化引擎                                      |
+-------------------------------------------------------------------------------------------------------------+
|  📍 [第 0 层: 代码拓扑]       -> GRAPHIFY / GITNEXUS / CODEGRAPH (AST 导航，零 Token 精准代码检索)          |
|  ✍️  [第 1 层: 代码精简]      -> PONYTAIL (KISS/YAGNI 原则，优先标准库，彻底消除样板冗余)                    |
|  💬 [第 2 层: 表达精简]      -> CAVEMAN (极简技术响应，强制生成紧凑 Git Patch Diff，拒绝废话)               |
|  ⚡ [第 3 层: 终端输出过滤]  -> RTK - Rust Token Killer (过滤 git/build/test 中 60-90% 的冗余日志)         |
|  🌐 [第 4 层: 上下文代理]     -> HEADROOM PROXY (无损 HTTP 上下文压缩与 90% Prompt Caching 命中)             |
+ - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - +
|  🧠 [第 5 层: 知识提取器]     -> MEMORAX CODE (自动从已完成任务沉淀架构规范与经验至记忆插槽)                 |
|                                             │                                                               |
|                                             ▼ (数据管道流转)                                                |
|  🗄️  [第 6 层: 上下文数据库]  -> OPENVIKING / OBSIDIAN VAULT (分层 L0/L1/L2 存储架构，节省 91% Token)        |
|                                         ├── viking://knowledge (3 层分级 RAG，大幅削减上下文开销)           |
|                                         ├── viking://skills    (动态按需加载 Skill，杜绝上下文膨胀)          |
|                                         └── viking://memory    (继承自 MemoraX 的持久化跨会话记忆)          |
+-------------------------------------------------------------------------------------------------------------+
```

---

## 📊 实证基准测试与各层效果总结 (Empirical Benchmark Summary)

基于 **5 个公开权威的开源 GitHub 数据集**（基线总量 29,497 Token）进行严格实证评估，7 层 Token Stack 实现了 **整体降低 95.9% 的 Token 消耗**（仅需 1,203 Token），同时将逻辑回答质量提升至 **100/100 满分（QA 质量提升 +19 分）**：

### 🏆 5 大基准场景测试总表：

| # | 测试场景 / 数据集 | 公开权威 GitHub 来源 | 最核心生效层 | 原始 Token | 压缩后 Token | 节省比例 % | 回答质量分 | 综合能效 CEI |
|:---:|:---|:---|:---|:---:|:---:|:---:|:---:|:---:|
| **1** | **代码库全局架构与数据流勘测** | [`hagopj13/node-express-boilerplate`](https://github.com/hagopj13/node-express-boilerplate) | **`L0: Graphify`** | 4,247 | **423** | **-90.0%** | **100/100** | **190.0 🏆** |
| **2** | **数据库连接池泄漏修复 (TDD Bugfix)** | [`gothinkster/node-express-realworld-example-app`](https://github.com/gothinkster/node-express-realworld-example-app) | **`L3: RTK` & `L2: Caveman`** | 4,250 | **210** | **-95.1%** | **100/100** | **195.1 🏆** |
| **3** | **跨会话架构规范精准召回** | [`THUIR/MemoryBench`](https://github.com/THUIR/MemoryBench-LeaderBoard) | **`L5: MemoraX` & `L4: Headroom`** | 6,250 | **45** | **-99.3%** | **100/100** | **199.3 🏆** |
| **4** | **8 轮复杂排错轨迹状态提炼** | [`THUIR/MemoryBench`](https://github.com/THUIR/MemoryBench-LeaderBoard) | **`L6: OpenViking`** | 6,250 | **195** | **-96.9%** | **100/100** | **196.9 🏆** |
| **5** | **历史 CSV 量化策略回测与参数调优** | [`kernc/backtesting.py`](https://github.com/kernc/backtesting.py) | **`L0: Graphify` & `L3: RTK`** | 8,500 | **330** | **-96.1%** | **100/100** | **196.1 🏆** |
| ★ | **5 大场景综合评估总量** | **开源 GitHub 基准库** | **完整 7 层 Token Stack** | **29,497** | **1,203** | **-95.9%** | **100/100** | **195.5 🏆** |

---

### 🎯 各层专长矩阵与应用场景 (Layer Specialty Matrix):

| 架构层级 | 代表工具 | 核心优势与实际作用 | 典型节省幅度 | 最佳应用场景 |
|:---|:---|:---|:---:|:---|
| **`L0: 代码拓扑`** | **Graphify / GitNexus / CodeGraph** | 通过构建 AST 依赖图谱，自动过滤 95% 无关源码与定义。 | **-82% 至 -91.5%** | 探索陌生代码库、梳理系统全局架构、解析复杂数据 Schema。 |
| **`L1: 代码精简`** | **Ponytail** | 强制执行 KISS/YAGNI 原则与标准库，消除冗余辅助代码与样板堆叠。 | **-3% 至 -16.5%** | 搭建新 API 端点、编写 Service 业务层、实现工具函数。 |
| **`L2: 表达精简`** | **Caveman** | 强制输出超紧凑 Git Patch Diff 代替全文件重写；去除无关对话废话。 | **-48% 至 -69.5%** | 修复 Bug、重构代码、生成补丁文件、代码审查批注。 |
| **`L3: 终端输出过滤`** | **RTK (Rust Token Killer)** | 实时过滤终端噪音，自动忽略通过的测试项与海量量化下单日志。 | **-54.7% 至 -58.5%** | 执行测试套件（`npm test`, `pytest`, `cargo test`）、构建编译与策略回测。 |
| **`L4: 上下文代理`** | **Headroom** | 无损 HTTP 代理，在长会话历史中精准激活 90% Prompt Cache 折扣。 | **-82.7% 至 -86.0%** | 上下文超过 5,000+ Token 的长轮次多对话工作流。 |
| **`L5: 知识提取器`** | **MemoraX Code** | 自动沉淀 UUID 主键、AppError 等系统规范为 45 Token 的精准记忆插槽。 | **-86% 至 -99.3%** | 维持多任务跨会话连贯性，无需重复加载历史对话。 |
| **`L6: 上下文数据库`** | **OpenViking** | 将 8 轮反复失败的排错轨迹提炼为单条高价值根因与终极解法。 | **-93.0% 至 -96.9%** | 复杂多轮试错排错、多 Subagent 协作上下文蒸馏。 |

---

### 🔬 逐层剔除消融实验 (Leave-One-Out Ablation Study):

如果关闭其中某一层会发生什么？消融实验在 5 大基准场景中实测了各层缺失的性能惩罚：

1. ❌ **禁用 `L0: Graphify` (膨胀 +15,684 Token，压缩率大幅滑坡 -53.2%):** 代码探索核心防御层。失去 L0 后，AI 将全量盲目读取目录中的所有文件。
2. ❌ **禁用 `L4: Headroom` (膨胀 +5,025 Token，压缩率降低 -17.0%):** 失去 Prompt Caching 断点，长会话每次调用都需在网络中重复传输海量历史。
3. ❌ **禁用 `L6: OpenViking` (膨胀 +2,530 Token，压缩率降低 -8.6%):** 失去排错轨迹蒸馏，8 轮失败日志直接填满上下文。
4. ❌ **禁用 `L5: MemoraX` (膨胀 +2,120 Token，压缩率降低 -7.2%):** 失去记忆插槽，AI 必须重新读取数千 Token 历史才能回忆起 UUID 规范。
5. ❌ **禁用 `L2: Caveman` (膨胀 +1,430 Token，压缩率降低 -4.8%):** AI 重新采用全量文件输出，浪费输出 Token。
6. ❌ **禁用 `L1: Ponytail` (膨胀 +950 Token，压缩率降低 -3.2%):** 代码中出现冗余重复的样板代码。
7. ❌ **禁用 `L3: RTK` (膨胀 +555 Token，压缩率降低 -1.9%):** 成百上千行通过的单元测试日志直接刷屏上下文。

👉 完整消融实验报告：[`token-stack-benchmark-report.md`](token-stack-benchmark-report.md)

---

## ⚡ 快速安装与配置 (Quick Start)

运行主安装脚本一键配置全部 7 层：

```powershell
# 试运行检查 (Dry-run)
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-token-stack.ps1

# 正式应用到指定 Profile 配置目录
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\install-token-stack.ps1 `
  -ProfileDirectory "$HOME\.claude" `
  -CodeTopology graphify `
  -Harvester memorax `
  -ContextDatabase openviking `
  -Apply
```

### 模块化单层独立安装器：
- **第 0 层 (代码拓扑)**: `.\scripts\install-code-graph.ps1 -Engine <graphify|gitnexus|codegraph|none> -Apply`
- **第 5 层 (知识提取器)**: `.\scripts\install-memory-layer.ps1 -Provider <memorax|none> -Apply`
- **第 6 层 (上下文数据库)**: `.\scripts\install-context-platform.ps1 -Platform <openviking|obsidian|local|none> -Apply`

---

## 🧪 运行标准化基准测试 (Benchmarks)

启动交互式 3 步 TUI 基准评测套件：

```bash
# 启动交互式 3 步基准测试 TUI（支持开关各层、设置测试轮次 N）
node ./skills/token-stack-benchmark/scripts/benchmark-tui.cjs

# 运行逐层剔除消融实验 (Leave-One-Out Ablation Study)
node ./skills/token-stack-benchmark/scripts/benchmark-tui.cjs --ablation

# 运行全自动 3 轮平均基准测试
node ./skills/token-stack-benchmark/scripts/benchmark-tui.cjs --non-interactive --runs 3
```

---

## 🩺 系统健康检查 (Health Check)

检查全部 7 层的连接与运行状态：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\skills\token-stack-health\scripts\token-stack-health.ps1
```

---

## 📚 详细文档索引
1. 架构深度解析：[`docs/architecture.md`](docs/architecture.md)
2. 多 Profile 环境配置指南：[`docs/setup-guide.md`](docs/setup-guide.md)
3. OpenAI Codex CLI 设置指南：[`docs/codex-setup-guide.md`](docs/codex-setup-guide.md)
4. 完整实证基准测试报告：[`token-stack-benchmark-report.md`](token-stack-benchmark-report.md)
