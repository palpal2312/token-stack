# 📊 Evaluation Metrics: Scenario #5

> **Title:** Scenario 5: Quant Strategy Backtesting on Historical OHLCV CSV Data
> **Public Source:** [kernc/backtesting.py](https://github.com/kernc/backtesting.py)

---

## 1️⃣ Table 1: Single Layer Isolated Efficiency

| Optimization Layer | Tokens Remaining | Token Usage Delta (%) | Answer Quality | QA Quality Delta | CEI Efficiency Index | Notes |
| :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| **Raw Baseline (No Layers)** | 8,500 tokens | **0.0%** | **80/100** | **0 pts (Raw)** | **80.0** | Raw baseline |
| **L0: Code Topology** | 1,500 tokens | **-82.4%** | **90/100** | **+10 pts** | **164.1** | ★ DOMINANT (Extracts Strategy AST) |
| **L1: Ponytail** | 7,100 tokens | **-16.5%** | **80/100** | **0 pts** | **93.2** | Eliminates boilerplate |
| **L2: Caveman** | 2,720 tokens | **-68.0%** | **100/100** | **+20 pts** | **168.0** | ★ DOMINANT (Outputs concise stats) |
| **L3: RTK** | 3,680 tokens | **-56.7%** | **100/100** | **+20 pts** | **156.7** | ★ DOMINANT (Filters 9,000 order logs) |
| **L4: Headroom** | 8,500 tokens | **0.0%** | **80/100** | **0 pts** | **80.0** | Neutral |
| **L5: Knowledge Memory** | 8,535 tokens | **+0.4%** | **100/100** | **+20 pts** | **100.0** | ⚠️ Injects memory slot |
| **L6: Autonomous Distill** | 8,525 tokens | **+0.3%** | **100/100** | **+20 pts** | **100.0** | ⚠️ Injects prefix summary |

---

## 2️⃣ Table 2: Progressive Cumulative Stacking Sequence (L0 ➔ L6)

| Layer Stacking Order | Tokens Remaining | Layer Delta | Token Usage Delta (%) | Cumulative Savings % | Answer Quality | QA Quality Delta | CEI Efficiency Index |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| **0. Raw Baseline (No Layers)** | 8,500 tokens | --- | **---** | **0.0%** | **80/100** | **--- (Raw)** | **80.0** |
| **+ L-1: Semantic Cache [Zero-Token Semantic Cache] 🏆** | 8,500 tokens | 0 | **0.0%** | **-0.0%** | **95/100** | **+15 pts** | **95.0** |
| **+ L0: Code Topology [Graphify] 🏆** | 1,500 tokens | Saved 7,000 | **-82.4%** | **-82.4%** | **95/100** | **+0 pts** | **173.2** |
| **+ L1: Ponytail [Ponytail] ** | 1,250 tokens | Saved 250 | **-16.7%** | **-85.3%** | **95/100** | **+0 pts** | **176.0** |
| **+ L2: Caveman [Caveman] 🏆** | 650 tokens | Saved 600 | **-48.0%** | **-92.4%** | **95/100** | **+0 pts** | **182.7** |
| **+ L3: RTK [RTK (Rust Token Killer)] 🏆** | 270 tokens | Saved 380 | **-58.5%** | **-96.8%** | **95/100** | **+0 pts** | **187.0** |
| **+ L4: Headroom [Headroom Proxy] 🏆** | 270 tokens | 0 | **0.0%** | **-96.8%** | **95/100** | **+0 pts** | **187.0** |
| **+ L5: Knowledge Memory [MemoraX Code] 🏆** | 305 tokens | +35 (Overhead) | **+13.0%** | **-96.4%** | **100/100** | **+5 pts** | **196.4** |
| **+ L6: Autonomous Distill [OpenViking] 🏆** | 330 tokens | +25 (Overhead) | **+8.2%** | **-96.1%** | **100/100** | **+0 pts** | **196.1** |
| **+ L7: Turn Folding [Dynamic Turn Folding] 🏆** | 280 tokens | Saved 50 | **-15.2%** | **-96.7%** | **100/100** | **+0 pts** | **196.7** |
| **+ L8: Loop Breaker [Loop Breaker & Failover] 🏆** | 280 tokens | 0 | **0.0%** | **-96.7%** | **100/100** | **+0 pts** | **196.7** |
| **+ L9: CoT Governor [CoT Budget Governor] 🏆** | 250 tokens | Saved 30 | **-10.7%** | **-97.1%** | **100/100** | **+0 pts** | **197.1** |
| **+ L10: Model Router [Model Cascading Router] 🏆** | 250 tokens | 0 | **0.0%** | **-97.1%** | **100/100** | **+0 pts** | **197.1** |

---

## 3️⃣ Table 3: Dual Rubric Evaluation

| Category | Verification Checkpoint in Agent Response | Score Weight | Status |
|:---:| :--- | :---: | :---: |
| **Core** | CSV Parsing: Formats DatetimeIndex and Open, High, Low, Close, Volume columns | 20 pts | **✅ PASSED** |
| **Core** | Strategy Class: Inherits Strategy, init() calculates SMA/RSI, next() triggers on crossover | 20 pts | **✅ PASSED** |
| **Core** | Backtest Setup: Initializes Backtest(data, SmaRsiStrategy, cash=10000, commission=0.002) | 20 pts | **✅ PASSED** |
| **Core** | Performance Metrics: Accurately extracts Return %, Sharpe Ratio, Max Drawdown %, Win Rate % | 20 pts | **✅ PASSED** |
| **Bonus** | Grid Optimization: Implements bt.optimize(maximize="Sharpe Ratio") | +10 pts | **🌟 BONUS PASSED** |
| **Bonus** | Recommends Lookahead Bias & Overfitting safeguards on in-sample backtest data | +10 pts | **🌟 BONUS PASSED** |

> **💡 Total Quality Score:** **100/100 pts** (CEI Index: **197.1 🏆**)
> **Assessment:** *"Flawless strategy backtest code, filters 9,000 order execution lines, extracts Sharpe/Drawdown with 100% precision."*
