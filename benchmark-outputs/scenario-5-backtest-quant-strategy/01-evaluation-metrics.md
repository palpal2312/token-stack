# 📊 Evaluation Metrics: Scenario #5

> **Title:** Scenario 5: Quant Strategy Backtesting on Historical OHLCV CSV Data
> **Public Source:** [kernc/backtesting.py](https://github.com/kernc/backtesting.py)

---

## 1️⃣ Table 1: Single Layer Isolated Efficiency

| Optimization Layer | Tokens Remaining | Token Usage Delta (%) | Answer Quality | QA Quality Delta | CEI Efficiency Index | Notes |
| :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| **Raw Baseline (No Layers)** | 8,500 tokens | **0.0%** | **80/100** | **0 pts (Raw)** | **80.0** | Raw baseline |
| **L1.5: Data Lens** | 150 tokens | **-98.2%** | **100/100** | **+20 pts** | **198.2** | ★ DOMINANT (Generates Data Contract & Tear-Sheet) |
| **L0: Code Topology** | 1,500 tokens | **-82.4%** | **90/100** | **+10 pts** | **164.1** | Extracts Strategy AST |
| **L1: Ponytail** | 7,100 tokens | **-16.5%** | **80/100** | **0 pts** | **93.2** | Eliminates boilerplate |
| **L2: Caveman** | 2,720 tokens | **-68.0%** | **100/100** | **+20 pts** | **168.0** | Outputs concise stats |
| **L3: RTK** | 3,680 tokens | **-56.7%** | **100/100** | **+20 pts** | **156.7** | Filters order logs |
| **L4: Headroom** | 8,500 tokens | **0.0%** | **80/100** | **0 pts** | **80.0** | Neutral |
| **L5: Knowledge Memory** | 8,535 tokens | **+0.4%** | **100/100** | **+20 pts** | **100.0** | ⚠️ Injects memory slot |
| **L6: Autonomous Distill** | 8,525 tokens | **+0.3%** | **100/100** | **+20 pts** | **100.0** | ⚠️ Injects prefix summary |

---

## 2️⃣ Table 2: Progressive Cumulative Stacking Sequence (L0 ➔ L6)

| Layer Stacking Order | Tokens Remaining | Layer Delta | Token Usage Delta (%) | Cumulative Savings % | Answer Quality | QA Quality Delta | CEI Efficiency Index |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| **0. Raw Baseline (No Layers)** | 8,500 tokens | --- | **---** | **0.0%** | **80/100** | **--- (Raw)** | **80.0** |
| **+ L-1: Semantic Cache [Zero-Token Semantic Cache] 🏆** | 8,500 tokens | 0 | **0.0%** | **-0.0%** | **95/100** | **+15 pts** | **95.0** |
| **+ L0: Code Topology [Graphify] 🏆** | 7,300 tokens | Saved 1,200 | **-14.1%** | **-14.1%** | **95/100** | **+0 pts** | **108.4** |
| **+ L0.5: Skill Router [SkillRouter (arXiv:2603.22455)] 🏆** | 7,300 tokens | 0 | **0.0%** | **-14.1%** | **100/100** | **+5 pts** | **114.1** |
| **+ L1.5: Data Lens [Zero-Row Data Lens] 🏆** | 1,300 tokens | Saved 6,000 | **-82.2%** | **-84.7%** | **100/100** | **+0 pts** | **184.7** |
| **+ L1: Ponytail [Ponytail] ** | 1,150 tokens | Saved 150 | **-11.5%** | **-86.5%** | **100/100** | **+0 pts** | **186.5** |
| **+ L2: Caveman [Caveman] 🏆** | 750 tokens | Saved 400 | **-34.8%** | **-91.2%** | **100/100** | **+0 pts** | **191.2** |
| **+ L3: RTK [RTK (Rust Token Killer)] 🏆** | 370 tokens | Saved 380 | **-50.7%** | **-95.6%** | **100/100** | **+0 pts** | **195.6** |
| **+ L4: Headroom [Headroom Proxy] 🏆** | 370 tokens | 0 | **0.0%** | **-95.6%** | **100/100** | **+0 pts** | **195.6** |
| **+ L5: Knowledge Memory [MemoraX Code] 🏆** | 405 tokens | +35 (Overhead) | **+9.5%** | **-95.2%** | **100/100** | **+0 pts** | **195.2** |
| **+ L6: Autonomous Distill [OpenViking] 🏆** | 430 tokens | +25 (Overhead) | **+6.2%** | **-94.9%** | **100/100** | **+0 pts** | **194.9** |
| **+ L7: Turn Folding [Dynamic Turn Folding] 🏆** | 380 tokens | Saved 50 | **-11.6%** | **-95.5%** | **100/100** | **+0 pts** | **195.5** |
| **+ L8: Loop Breaker [Loop Breaker & Failover] 🏆** | 380 tokens | 0 | **0.0%** | **-95.5%** | **100/100** | **+0 pts** | **195.5** |
| **+ L9: CoT Governor [CoT Budget Governor] 🏆** | 350 tokens | Saved 30 | **-7.9%** | **-95.9%** | **100/100** | **+0 pts** | **195.9** |
| **+ L10: Model Router [Model Cascading Router] 🏆** | 350 tokens | 0 | **0.0%** | **-95.9%** | **100/100** | **+0 pts** | **195.9** |

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

> **💡 Total Quality Score:** **100/100 pts** (CEI Index: **195.9 🏆**)
> **Assessment:** *"Flawless strategy backtest code, filters 9,000 order execution lines, extracts Sharpe/Drawdown with 100% precision."*
