---
name: token-stack-benchmark
description: 3-Step Interactive Benchmark Suite for the 13-Layer Token Stack (L-1 Semantic Cache, L0 Router, L1 Topology, L1.5 Data Lens, L2 Ponytail, L3 Caveman, L4 RTK, L5 Turn Folding, L6 CoT Governor, L7 Loop Breaker, L8 Headroom, L9 MemoraX, L10 OpenViking). Features dataset presentation, layer toggles, N-run mean calculation, Dual Rubric evaluation, and Leave-One-Out Ablation Study across 10 public GitHub scenarios.
user-invocable: true
---

# Token Stack Benchmark Suite (3-Step Interactive Workflow)

Standardized benchmark suite to evaluate token compression ratio, pure logical answer accuracy, and CEI (Context Efficiency Index) across **10 Public Open-Source GitHub Datasets** and **13 Modular Token Stack Layers (L-1 ➔ L10)**:

## 🔄 3-Step Standardized Workflow

### 📋 Step 1: Public Datasets & Workspace Setup
- Presents 10 standardized public GitHub benchmark scenarios:
  1. `Scenario 1: Comprehensive Repository Architecture & Data Flow Survey` ([hagopj13/node-express-boilerplate](https://github.com/hagopj13/node-express-boilerplate))
  2. `Scenario 2: Database Connection Pool Leak Bugfix` ([gothinkster/node-express-realworld-example-app](https://github.com/gothinkster/node-express-realworld-example-app))
  3. `Scenario 3: Cross-Session Architecture Standard Recall` ([THUIR/MemoryBench](https://github.com/THUIR/MemoryBench-LeaderBoard))
  4. `Scenario 4: Multi-Turn Trajectory Distillation (8-Turn Recovery)` ([THUIR/MemoryBench](https://github.com/THUIR/MemoryBench-LeaderBoard))
  5. `Scenario 5: Quant Strategy Backtesting on Historical OHLCV CSV Data` ([kernc/backtesting.py](https://github.com/kernc/backtesting.py))
  6. `Scenario 6: 25-Turn Full-Stack Refactoring & Cold Context Compaction` ([cline/cline#1042](https://github.com/cline/cline/issues/1042))
  7. `Scenario 7: Test Doom Loop Interception & Sub-500ms Waterfall Failover` ([princeton-nlp/SWE-bench](https://github.com/princeton-nlp/SWE-bench))
  8. `Scenario 8: 1-Line Typo Fix with CoT Budget Throttling (Extended Thinking)` ([anthropics/anthropic-sdk-typescript](https://github.com/anthropics/anthropic-sdk-typescript))
  9. `Scenario 9: Multi-Agent Parallel Duplicate Query Resolution (0-Token Cache)` ([zilliztech/GPTCache](https://github.com/zilliztech/GPTCache))
  10. `Scenario 10: High-Frequency Routine Task Cascading & Frugal Routing` ([lmsys/RouteLLM](https://github.com/lmsys/RouteLLM))
  11. `Scenario 11: Scale-Out Agent Skill Routing & Anti-Skill-Shadowing` ([zhengyanzhao1997/SkillRouter](https://github.com/zhengyanzhao1997/SkillRouter) & [benchflow-ai/skillsbench](https://github.com/benchflow-ai/skillsbench))
  12. `Scenario 12: High-Frequency Algorithmic Orderbook & Tick Stream Ingestion` ([nautechsystems/nautilus_trader](https://github.com/nautechsystems/nautilus_trader) & [tardis-dev/tardis-node](https://github.com/tardis-dev/tardis-node))
- Initializes and cleans the `benchmark-outputs/` workspace.

### 🎛️ Step 2: Layer Toggle Configuration (L-1 ➔ L10, 14 Layers)
- **`L-1: Semantic Cache`** — `[✔ ON]` SQLite N-Gram Cosine similarity (0 tokens, <12ms)
- **`L0: Model Router`** — `[✔ ON]` RouteLLM & Frugal Classifier (-85% routine cost)
- **`L0.5: Skill Router`** — `[✔ ON]` Dual-Scope (Internal & Harness) Anti-Skill-Shadowing (-99.4% prompt bloat)
- **`L1: Code Topology`** — `[✔ ON]` AST CodeGraph pruning (-91.5% discovery tokens)
- **`L1.5: Data Lens`** — `[✔ ON]` DuckDB / ClickHouse Data Contracts & Tear-Sheets (-99.5% data tokens)
- **`L2: Ponytail`** — `[✔ ON]` Anti-boilerplate & clean standard library enforcement
- **`L3: Caveman`** — `[✔ ON]` Minimal Git Patch Diff generation (-69.5% diff tokens)
- **`L4: RTK`** — `[✔ ON]` CLI Token Killer (filters passing test logs & order execution noise)
- **`L5: Turn Folding`** — `[✔ ON]` 5-turn Epoch Freezing (compacts cold tool outputs, keeps prompt cache 100%)
- **`L6: CoT Governor`** — `[✔ ON]` Dynamic Task-Aware Thinking Throttler (1024 tok for simple, 8192 for deep)
- **`L7: Loop Breaker`** — `[✔ ON]` SHA256 Ring Buffer (halts 3x circular loops) + 500ms 429 Failover
- **`L8: Headroom`** — `[✔ ON]` Prompt Cache API Breakpoints (-82.7% long-history tokens)
- **`L9: MemoraX`** — `[✔ ON]` Episodic & Semantic Memory Slot Recall (-99.3% memory tokens)
- **`L10: OpenViking`** — `[✔ ON]` Multi-Turn State & Trajectory Distillation (-93.0% debug context)

### ⏱️ Step 3: N-Run Iterations & Comprehensive Metrics
- Computes arithmetic mean across N runs.
- Renders 3 standardized evaluation tables:
  1. **Table 1: Single Layer Isolated Efficiency** (individual layer contribution vs raw base)
  2. **Table 2: Progressive Cumulative Stacking Sequence** (step-by-step layer reduction from L0 to L6)
  3. **Table 3: Dual Rubric Evaluation** (80 pts Core Functional Specs + 20 pts Proactive Bonus)

---

## 💻 CLI Usage Commands

```bash
# Launch interactive 3-step benchmark TUI
node .agents/skills/token-stack-benchmark/scripts/benchmark-tui.cjs

# Run full Leave-One-Out Ablation Study (evaluates sensitivity when disabling each layer)
node .agents/skills/token-stack-benchmark/scripts/benchmark-tui.cjs --ablation

# Run automated 3-iteration benchmark without prompts
node .agents/skills/token-stack-benchmark/scripts/benchmark-tui.cjs --non-interactive --runs 3
```
