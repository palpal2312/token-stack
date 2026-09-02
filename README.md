# token-stack

The Complete **12-Layer Master Token & Context Engine** for AI coding CLIs (OpenAI Codex CLI, Claude Code, Cursor, Kimi, Antigravity).

[![Benchmark Status](https://img.shields.io/badge/Benchmark-97.1%25%20Token%20Reduction-brightgreen)](token-stack-benchmark-report.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Vietnamese Docs](https://img.shields.io/badge/Docs-%F0%9F%87%BB%F0%9F%87%B3%20Ti%E1%BA%BFng%20Vi%E1%BB%87t-red)](README-vi.md)
[![Real-World Case Studies](https://img.shields.io/badge/Case%20Studies-5%20Fail--Modes%20Solved-purple)](docs/examples/real-world-github-cases.md)

---

## 🌐 Language Navigation / Chuyển Đổi Ngôn Ngữ / 语言导航
| [🇬🇧 English (Current)](README.md) | [🇻🇳 Tiếng Việt (Vietnamese)](README-vi.md) | [🇨🇳 简体中文 (Chinese)](README-zh.md) |
|:---:|:---:|:---:|

---

## 🏗️ The 12-Layer Master Architecture

```text
+-------------------------------------------------------------------------------------------------------------+
|                                        THE 12-LAYER MASTER CONTEXT STACK                                    |
+-------------------------------------------------------------------------------------------------------------+
|  ⚡ [Layer -1: Semantic Cache]     -> SQLite-VSS N-Gram Vector Cache (0 tokens, <12ms for repeated queries)     |
|  🎯 [Layer 0: Model Router]        -> RouteLLM / Frugal Cascader (Dispatches easy tasks to cheap tier, -85% $) |
|  📍 [Layer 1: Code Topology]       -> GRAPHIFY / AIDER REPO-MAP (AST navigation, 0 token search)                |
|  ✍️  [Layer 2: Code Reduction]      -> PONYTAIL (KISS, YAGNI, standard library, no boilerplate)                   |
|  💬 [Layer 3: Word Reduction]      -> CAVEMAN (Concise technical responses, Git patch diffs, no fluff)          |
|  ⚡ [Layer 4: CLI Output Filter]    -> RTK - Rust Token Killer (60-90% log reduction on git/build/test)           |
|  🔄 [Layer 5: In-Flight Folding]   -> 5-Turn Epoch Freezing (Folds cold tool results >1000ch, keeps cache 100%) |
|  🧠 [Layer 6: CoT Governor]        -> Dynamic Task-Aware Thinking Throttler (1024 tok for simple, 8192 for deep)|
|  🛡️  [Layer 7: Loop Breaker]        -> SHA256 Ring Buffer (Halts 3x circular loops) + 500ms 429 Failover         |
|  🌐 [Layer 8: Context Proxy]       -> HEADROOM PROXY (Lossless HTTP context compression & prompt caching)       |
|  🎓 [Layer 9: Knowledge Harvester] -> MEMORAX CODE (Auto-extracts lessons & procedures from completed tasks)     |
|  🗄️  [Layer 10: Context Database]   -> OPENVIKING / OBSIDIAN VAULT (Hierarchical 3-tier L0/L1/L2 storage)          |
+-------------------------------------------------------------------------------------------------------------+
```

---

## 💡 Real-World GitHub Case Studies & Fail-Mode Teardowns

Read the complete technical case studies: [**docs/examples/real-world-github-cases.md**](docs/examples/real-world-github-cases.md)

| Real-World Production Incident | Root Cause on GitHub | Token-Stack Layer & Solution | Empirical Impact |
|:---|:---|:---|:---:|
| **Mid-Session Memory Cliff** | Stale 1,200-line tool outputs re-transmitted for 20 turns | **L7 (Dynamic Turn Folding)**: 5-turn epoch freezing | **-93.2% cold token reduction** |
| **Infinite Test Doom Loop** | Agent repeats failing test 15x in a circle, exhausts quota | **L8 (Loop Breaker & Failover)**: SHA256 ring buffer + 500ms failover | **Zero session crashes on 429** |
| **8k Thinking on 1-Line Typo** | Extended thinking model enters 14s overthinking spiral on typo | **L6 (CoT Budget Governor)**: Task-aware classifier caps budget at 1024 | **-94.8% thinking tokens**, 1.4s resp |
| **Multi-Agent Redundant Query**| 5 parallel subagents ask identical architecture questions | **L-1 (Semantic Cache)**: SQLite vector cosine similarity | **0 API Tokens (100% free)** |
| **$100/mo on Git Commits** | Flagship Sonnet/Opus used for commit messages & CSS format | **L0 (Model Cascading Router)**: Routes routine turns to Kimi / DeepSeek | **-85% monthly routine spend** |

---

## 📊 Empirical Benchmark & Layer Evaluation Summary

Based on rigorous testing across **5 public ground-truth open-source GitHub datasets** (29,497 total baseline tokens), the 12-Layer Token Stack achieves an overall **-97.1% token reduction** (down to 853 tokens) while boosting logical answer quality to **100/100 (+20 pts QA Delta)**:

### 🏆 Master Summary Table Across 5 Benchmark Scenarios:

| # | Scenario / Task Dataset | Public Ground Truth Source | Dominant Layer | Raw Tokens | Compressed Tokens | Savings % | Quality Score | CEI Index |
|:---:|:---|:---|:---|:---:|:---:|:---:|:---:|:---:|
| **1** | **Codebase Architecture Survey** | [`hagopj13/node-express-boilerplate`](https://github.com/hagopj13/node-express-boilerplate) | **`L1: Graphify`** | 4,247 | **298** | **-93.0%** | **100/100** | **193.0 🏆** |
| **2** | **DB Connection Pool Leak (TDD Bugfix)** | [`gothinkster/node-express-realworld-example-app`](https://github.com/gothinkster/node-express-realworld-example-app) | **`L4: RTK` & `L3: Caveman`** | 4,250 | **160** | **-96.2%** | **100/100** | **196.2 🏆** |
| **3** | **Cross-Session Standard Recall** | [`THUIR/MemoryBench`](https://github.com/THUIR/MemoryBench-LeaderBoard) | **`L9: MemoraX` & `L8: Headroom`** | 6,250 | **35** | **-99.4%** | **100/100** | **199.4 🏆** |
| **4** | **Multi-Turn Trajectory Distillation (8 Turns)** | [`THUIR/MemoryBench`](https://github.com/THUIR/MemoryBench-LeaderBoard) | **`L10: OpenViking`** | 6,250 | **110** | **-98.2%** | **100/100** | **198.2 🏆** |
| **5** | **Quant Strategy Backtesting on CSV** | [`kernc/backtesting.py`](https://github.com/kernc/backtesting.py) | **`L1: Graphify` & `L4: RTK`** | 8,500 | **250** | **-97.1%** | **100/100** | **197.1 🏆** |
| ★ | **TOTAL ACROSS ALL 5 SCENARIOS** | **Open-Source GitHub Benchmarks** | **Full 12-Layer Master Stack** | **29,497** | **853** | **-97.1%** | **100/100** | **196.8 🏆** |

---

### 🎯 Where Each Layer Shines (Layer Specialty Matrix):

| Layer | Primary Tool | Core Strength & Use Case | Typical Token Savings | When to Use |
|:---|:---|:---|:---:|:---|
| **`L0: Code Topology`** | **Graphify / GitNexus / CodeGraph** | Prunes 95% of irrelevant source files by building an AST dependency graph. | **-82% to -91.5%** | Exploring unfamiliar repositories, surveying architectural layout, parsing schemas. |
| **`L1: Code Reduction`** | **Ponytail** | Enforces KISS, YAGNI, and standard library usage; suppresses repetitive boilerplate. | **-3% to -16.5%** | Scaffolding services, writing API handlers, writing helper functions. |
| **`L2: Word Reduction`** | **Caveman** | Replaces lengthy conversational explanations and full-file dumps with compact unified Git Patch Diffs. | **-48% to -69.5%** | Applying code changes, debugging, refactoring, and code review comments. |
| **`L3: CLI Output Filter`** | **RTK (Rust Token Killer)** | Filters terminal output noise, passing test lines, and repetitive log rows. | **-54.7% to -58.5%** | Running test suites (`npm test`, `pytest`, `cargo test`), builds, and backtest loops. |
| **`L4: Context Proxy`** | **Headroom** | Lossless HTTP proxy optimizing 90% prompt cache breakpoints on long context histories. | **-82.7% to -86.0%** | Extended conversation sessions exceeding 5,000+ context tokens. |
| **`L5: Knowledge Harvester`** | **MemoraX Code** | Auto-extracts durable architectural rules, UUID patterns, and error standards into 45-token memory slots. | **-86% to -99.3%** | Cross-session continuity, remembering conventions across multiple user tasks. |
| **`L6: Context Database`** | **OpenViking** | Compresses multi-turn failure trajectories (e.g. 8 failed debug loops) into a single high-signal resolution state. | **-93.0% to -96.9%** | Complex debugging pipelines, multi-round trial-and-error tasks, subagent distillation. |

---

### 🔬 Leave-One-Out Ablation Study (Sensitivity Analysis):

What happens when you turn off individual layers? Our Leave-One-Out Ablation Study measured the exact penalty across all 5 benchmark scenarios:

1. ❌ **Disabling `L0: Graphify` (+15,684 tokens bloat, -53.2% compression loss):** Most critical layer for repository discovery. Without it, the agent blindly dumps entire directories into context.
2. ❌ **Disabling `L4: Headroom` (+5,025 tokens bloat, -17.0% compression loss):** Without prompt caching, long multi-turn sessions incur massive API re-transmission costs.
3. ❌ **Disabling `L6: OpenViking` (+2,530 tokens bloat, -8.6% compression loss):** Without trajectory distillation, 8-turn debug sessions flood context with duplicate error logs.
4. ❌ **Disabling `L5: MemoraX` (+2,120 tokens bloat, -7.2% compression loss):** Without memory slots, the agent must reload thousands of historical prompt tokens to recall simple system rules.
5. ❌ **Disabling `L2: Caveman` (+1,430 tokens bloat, -4.8% compression loss):** Without patch diffs, full-file replacements consume unnecessary tokens.
6. ❌ **Disabling `L1: Ponytail` (+950 tokens bloat, -3.2% compression loss):** Lets repetitive helper boilerplate creep into codebase.
7. ❌ **Disabling `L3: RTK` (+555 tokens bloat, -1.9% compression loss):** Leaves thousands of lines of passing test logs in terminal output.

👉 Full Ablation Dossier: [`token-stack-benchmark-report.md`](token-stack-benchmark-report.md)

---

## ⚡ Quick Start & Installation

Run the master installer to configure all 7 layers automatically:

```powershell
# Dry-run inspection
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-token-stack.ps1

# Apply to target profile with custom engines
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\install-token-stack.ps1 `
  -ProfileDirectory "$HOME\.claude" `
  -CodeTopology graphify `
  -Harvester memorax `
  -ContextDatabase openviking `
  -Apply
```

### Modular Layer Installers:
- **Layer 0 (Code Topology)**: `.\scripts\install-code-graph.ps1 -Engine <graphify|gitnexus|codegraph|none> -Apply`
- **Layer 5 (Knowledge Harvester)**: `.\scripts\install-memory-layer.ps1 -Provider <memorax|none> -Apply`
- **Layer 6 (Context Database Platform)**: `.\scripts\install-context-platform.ps1 -Platform <openviking|obsidian|local|none> -Apply`

---

## 🧪 Running the Standardized Benchmark Suite

Launch the interactive 3-step benchmark TUI:

```bash
# Launch 3-Step Interactive Benchmark TUI (Toggle layers, configure N runs)
node ./skills/token-stack-benchmark/scripts/benchmark-tui.cjs

# Run full Leave-One-Out Ablation Study
node ./skills/token-stack-benchmark/scripts/benchmark-tui.cjs --ablation

# Run non-interactive 3-run average benchmark
node ./skills/token-stack-benchmark/scripts/benchmark-tui.cjs --non-interactive --runs 3
```

---

## 🩺 Health Verification

Verify connectivity across all 7 layers:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\skills\token-stack-health\scripts\token-stack-health.ps1
```

## 🛠️ Token-Stack 2.0 Unified CLI

Inspired by `sub2api` clean modular architecture, Token-Stack 2.0 provides a single unified CLI (`token-stack`) with centralized registry and process supervision:

```powershell
# Live Profile & Proxy Table
token-stack status

# Full 7-Layer Health & Diagnostic Probe
token-stack doctor

# Automated 3-Stage E2E Stream Verification (Readyz -> Upstream -> Proxy Stream)
token-stack verify kimicode

# Manage Multi-Instance Headroom Proxies
token-stack up --all
token-stack down

# Register New Profile with Auto-Allocated Port & DB Isolation
token-stack profile add my-agent --upstream https://api.kimi.com/coding --model kimi-k3
```

Or using the standard `Makefile`:
```bash
make status
make up
make doctor
make verify
```

---

## 📚 Documentation
1. Architecture Deep-Dive: [`docs/architecture.md`](docs/architecture.md)
2. Multi-Profile Setup Guide: [`docs/setup-guide.md`](docs/setup-guide.md)
3. OpenAI Codex CLI Setup Guide: [`docs/codex-setup-guide.md`](docs/codex-setup-guide.md)
4. Comprehensive Benchmark Report: [`token-stack-benchmark-report.md`](token-stack-benchmark-report.md)
5. Architecture Overhaul Plan: [`plans/260902-2335-token-stack-architecture-overhaul/plan.md`](plans/260902-2335-token-stack-architecture-overhaul/plan.md)
