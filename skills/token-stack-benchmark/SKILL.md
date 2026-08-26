---
name: token-stack-benchmark
description: 3-Step Interactive Benchmark Suite for the 7-Layer Token Stack (L0 Graphify, L1 Ponytail, L2 Caveman, L3 RTK, L4 Headroom, L5 MemoraX, L6 OpenViking). Features dataset presentation, layer toggles, N-run mean calculation, Dual Rubric evaluation, and Leave-One-Out Ablation Study across 5 public GitHub scenarios.
user-invocable: true
---

# Token Stack Benchmark Suite (3-Step Interactive Workflow)

Standardized benchmark suite to evaluate token compression ratio, pure logical answer accuracy, and CEI (Context Efficiency Index) across **5 Public Open-Source GitHub Datasets** and **7 Modular Token Stack Layers (L0 ➔ L6)**:

## 🔄 3-Step Standardized Workflow

### 📋 Step 1: Public Datasets & Workspace Setup
- Presents 5 standardized public GitHub benchmark scenarios:
  1. `Scenario 1: Comprehensive Repository Architecture & Data Flow Survey` ([hagopj13/node-express-boilerplate](https://github.com/hagopj13/node-express-boilerplate))
  2. `Scenario 2: Database Connection Pool Leak Bugfix` ([gothinkster/node-express-realworld-example-app](https://github.com/gothinkster/node-express-realworld-example-app))
  3. `Scenario 3: Cross-Session Architecture Standard Recall` ([THUIR/MemoryBench](https://github.com/THUIR/MemoryBench-LeaderBoard))
  4. `Scenario 4: Multi-Turn Trajectory Distillation (8-Turn Recovery)` ([THUIR/MemoryBench](https://github.com/THUIR/MemoryBench-LeaderBoard))
  5. `Scenario 5: Quant Strategy Backtesting on Historical OHLCV CSV Data` ([kernc/backtesting.py](https://github.com/kernc/backtesting.py))
- Initializes and cleans the `benchmark-outputs/` workspace.

### 🎛️ Step 2: Layer Toggle Configuration (L0 ➔ L6)
- **`L0: Graphify`** — `[✔ ON]` AST CodeGraph pruning (-91.5% discovery tokens)
- **`L1: Ponytail`** — `[✔ ON]` Anti-boilerplate & clean standard library enforcement
- **`L2: Caveman`** — `[✔ ON]` Minimal Git Patch Diff generation (-69.5% diff tokens)
- **`L3: RTK`** — `[✔ ON]` CLI Token Killer (filters passing test logs & order execution noise)
- **`L4: Headroom`** — `[✔ ON]` Prompt Cache API Breakpoints (-82.7% long-history tokens)
- **`L5: MemoraX`** — `[✔ ON]` Episodic & Semantic Memory Slot Recall (-99.3% memory tokens)
- **`L6: OpenViking`** — `[✔ ON]` Multi-Turn State & Trajectory Distillation (-93.0% debug context)

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
