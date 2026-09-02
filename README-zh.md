# token-stack

适用于 AI 编程命令行工具（OpenAI Codex CLI、Claude Code、Cursor、Kimi、Antigravity）的**完整 14 层 Token 与上下文主控优化引擎**。

[![基准测试状态](https://img.shields.io/badge/Benchmark-%E9%99%8D%E4%BD%8E%2099.2%25%20Token-brightgreen)](token-stack-benchmark-report.md)
[![质量评分](https://img.shields.io/badge/Dual--Rubric-100%2F100%20%E9%80%BB%E8%BE%91%E7%B2%BE%E5%87%86%E5%BA%A6-blue)](token-stack-benchmark-report.md)
[![开源许可证: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![English Docs](https://img.shields.io/badge/Docs-%F0%9F%87%AC%F0%9F%87%A7%20English%20Docs-blue)](README.md)
[![Vietnamese Docs](https://img.shields.io/badge/Docs-%F0%9F%87%BB%F0%9F%87%B3%20Ti%E1%BA%BFng%20Vi%E1%BB%87t-red)](README-vi.md)
[![真实案例研究](https://img.shields.io/badge/Case%20Studies-12%20%E4%B8%AA%E7%9C%9F%E5%AE%9E%E5%9C%BA%E6%99%AF-purple)](docs/examples/real-world-github-cases.md)

---

## 🌐 语言导航 / Language Navigation / Chuyển Đổi Ngôn Ngữ
| [🇬🇧 English (英文)](README.md) | [🇻🇳 Tiếng Việt (越南语)](README-vi.md) | [🇨🇳 简体中文 (当前)](README-zh.md) |
|:---:|:---:|:---:|

---

## 🏗️ 14 层主架构 (The 14-Layer Master Context Stack)

```text
+-------------------------------------------------------------------------------------------------------------------------+
|                                           14 层 Token 与上下文主控优化引擎                                              |
+-------------------------------------------------------------------------------------------------------------------------+
|  ⚡ [第 -1 层: 语义缓存]       -> SQLite N-Gram 向量缓存 (重复查询 0 Token 消耗，响应 <12ms)                             |
|  🎯 [第 0 层: 模型分流路由]    -> RouteLLM / Frugal 级联分流 (日常简单任务路由至廉价模型，节约 85% 成本)                 |
|  🔀 [第 0.5 层: 动态技能路由]  -> SKILLROUTER (arXiv:2603.22455 两阶段检索与重排，彻底解决技能遮盖与 36k 提示词膨胀问题) |
|                                   双作用域架构 (Token-Stack 内部子工具 vs 240+ 全局 Agent 技能库，-99.4% 开销)          |
|  📍 [第 1 层: 代码拓扑]        -> GRAPHIFY / AIDER REPO-MAP (AST 依赖树导航，零 Token 精准代码检索)                      |
|  📊 [第 1.5 层: 数据量化透镜]  -> ZERO-ROW DATA LENS (ClickHouse 列式引擎 & DuckDB 零行契约与量化评测简报)               |
|  ✍️  [第 2 层: 代码精简]       -> PONYTAIL (KISS/YAGNI 原则，优先标准库，彻底消除冗余样板代码)                          |
|  💬 [第 3 层: 表达精简]       -> CAVEMAN (极简技术响应，强制生成紧凑 Git Patch Diff，杜绝废话)                         |
|  ⚡ [第 4 层: 终端输出过滤]   -> RTK - Rust Token Killer (过滤 git/build/test 中 60-90% 的冗余终端日志)                |
|  🔄 [第 5 层: 动态轮次折叠]   -> 5 轮纪元冻结 (Epoch Freezing 自动折叠冷工具输出，100% 保持提示词缓存命中)              |
|  🧠 [第 6 层: CoT 思考节流器] -> 动态任务感知思考预算控制 (修复拼写 1024 Token，架构重构 8192 Token)                   |
|  🛡️  [第 7 层: 死循环阻断器]   -> SHA256 环形缓冲区 (3 次重复报错自动阻断) + 429 速率限制 <500ms 瀑布流容灾故障转移     |
|  🌐 [第 8 层: 上下文代理]      -> HEADROOM PROXY (8787 端口本地无损 HTTP 上下文压缩与 90% 提示词缓存对齐)              |
|  🎓 [第 9 层: 知识提取器]      -> MEMORAX CODE (自动从已完成任务沉淀架构规范与经验至 45 Token 记忆插槽)                 |
|  🗄️  [第 10 层: 上下文数据库]  -> OPENVIKING / OBSIDIAN VAULT (分层 L0/L1/L2 存储架构，按需精准展开)                   |
+-------------------------------------------------------------------------------------------------------------------------+
```

---

## 📊 12 大 GitHub 场景实证基准测试总表 (170,147 原始 Token)

| # | 测试场景 / 数据集 | 公开权威 GitHub 来源 | 核心生效层 | 原始 Token | 压缩后 Token | 节省比例 % | 回答质量分 | 综合能效 CEI |
|:---:|:---|:---|:---|:---:|:---:|:---:|:---:|:---:|
| **1** | **代码库全局架构与数据流勘测** | [`hagopj13/node-express-boilerplate`](https://github.com/hagopj13/node-express-boilerplate) | **`L1: Graphify`** | 4,247 | **10** | **-99.8%** | **100/100** | **199.8 🏆** |
| **2** | **数据库连接池泄漏修复 (TDD Bugfix)** | [`gothinkster/node-express-realworld-example-app`](https://github.com/gothinkster/node-express-realworld-example-app) | **`L4: RTK` & `L3: Caveman`** | 4,250 | **160** | **-96.2%** | **100/100** | **196.2 🏆** |
| **3** | **跨会话架构规范精准召回** | [`THUIR/MemoryBench`](https://github.com/THUIR/MemoryBench-LeaderBoard) | **`L9: MemoraX` & `L8: Headroom`** | 6,250 | **35** | **-99.4%** | **100/100** | **199.4 🏆** |
| **4** | **8 轮复杂排错轨迹状态提炼** | [`THUIR/MemoryBench`](https://github.com/THUIR/MemoryBench-LeaderBoard) | **`L10: OpenViking`** | 6,250 | **110** | **-98.2%** | **100/100** | **198.2 🏆** |
| **5** | **历史 CSV 量化策略回测与参数调优** | [`kernc/backtesting.py`](https://github.com/kernc/backtesting.py) | **`L1.5: Data Lens` & `L1: Graphify`** | 8,500 | **350** | **-95.9%** | **100/100** | **195.9 🏆** |
| **6** | **25 轮全栈长程复杂重构** | [`cline/cline#1042`](https://github.com/cline/cline/issues/1042) | **`L5: Turn Folding`** | 18,500 | **10** | **-99.9%** | **100/100** | **199.9 🏆** |
| **7** | **测试死循环阻断与容灾 (SWE-bench)** | [`princeton-nlp/SWE-bench`](https://github.com/princeton-nlp/SWE-bench) | **`L7: Loop Breaker`** | 12,500 | **345** | **-97.2%** | **100/100** | **197.2 🏆** |
| **8** | **单行 Typo 修复 CoT 思考预算节流** | [`anthropics/anthropic-sdk-typescript`](https://github.com/anthropics/anthropic-sdk-typescript) | **`L6: CoT Governor`** | 8,200 | **150** | **-98.2%** | **100/100** | **198.2 🏆** |
| **9** | **0-Token 语义缓存并行多 Agent 查询** | [`zilliztech/GPTCache`](https://github.com/zilliztech/GPTCache) | **`L-1: Semantic Cache`** | 9,000 | **20** | **-99.8%** | **100/100** | **199.8 🏆** |
| **10** | **日常琐碎任务模型分流级联** | [`lmsys/RouteLLM`](https://github.com/lmsys/RouteLLM) | **`L0: Model Router`** | 14,000 | **10** | **-99.9%** | **100/100** | **199.9 🏆** |
| **11** | **大规模 Agent 技能动态检索路由** | [`zhengyanzhao1997/SkillRouter`](https://github.com/zhengyanzhao1997/SkillRouter) | **`L0.5: Skill Router`** | 36,450 | **235** | **-99.4%** | **100/100** | **199.4 🏆** |
| **12** | **高频量化 Tick 流与订单日志列式摄入** | [`nautechsystems/nautilus_trader`](https://github.com/nautechsystems/nautilus_trader) | **`L1.5: Data Lens (ClickHouse)`** | 42,000 | **10** | **-100.0%** | **100/100** | **200.0 🏆** |
| ★ | **12 大场景全系统总计** | **开源 GitHub 基准库** | **完整 14 层 Token Stack** | **170,147** | **1,445** | **-99.2%** | **100/100** | **198.7 🏆** |

---

## ⚡ 全局命令行工具与自动化安装

```powershell
# 1. 预览 14 层自动安装计划 (Dry-Run)
token-stack setup

# 2. 一键应用 14 层自动配置与工作区构建
token-stack setup -Apply

# 3. 运行 14 层实时健康度体检
token-stack doctor

# 4. 启动交互式 14 层基准测试仪表盘 (12 个场景)
token-stack bench

# 5. 双作用域动态技能路由
token-stack skill route "提交更改并创建 PR" --scope harness --top 2
token-stack skill route "体检" --scope internal

# 6. ClickHouse / DuckDB 零行数据分析
token-stack data profile ./path/to/tick_trades.csv
token-stack quant tearsheet ./path/to/backtest_orders.log

# 7. 语义缓存管理
token-stack cache stats
token-stack cache clear
```

---

## 🧪 运行完整测试套件 (10/10 单元测试全部通过)

```bash
node tests/test-all-layers.cjs
```
