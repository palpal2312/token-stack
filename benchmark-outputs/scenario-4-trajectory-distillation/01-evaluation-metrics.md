# 📊 Evaluation Metrics: Scenario #4

> **Title:** Scenario 4: Multi-Turn Trajectory Distillation (8-Turn Failure Recovery)
> **Public Source:** [THUIR/MemoryBench-LeaderBoard](https://github.com/THUIR/MemoryBench-LeaderBoard)

---

## 1️⃣ Table 1: Single Layer Isolated Efficiency

| Optimization Layer | Tokens Remaining | Token Usage Delta (%) | Answer Quality | QA Quality Delta | CEI Efficiency Index | Notes |
| :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| **Raw Baseline (No Layers)** | 6,250 tokens | **0.0%** | **70/100** | **0 pts (Raw)** | **70.0** | Raw baseline |
| **L0: Code Topology** | 5,375 tokens | **-14.0%** | **70/100** | **0 pts** | **79.8** | Supporting |
| **L1: Ponytail** | 5,800 tokens | **-7.2%** | **70/100** | **0 pts** | **75.0** | Supporting |
| **L2: Caveman** | 6,200 tokens | **-0.8%** | **70/100** | **0 pts** | **70.6** | Supporting |
| **L3: RTK** | 6,250 tokens | **0.0%** | **70/100** | **0 pts** | **70.0** | Neutral |
| **L4: Headroom** | 5,100 tokens | **-18.4%** | **75/100** | **+5 pts** | **88.8** | Supporting |
| **L5: Knowledge Memory** | 4,200 tokens | **-32.8%** | **85/100** | **+15 pts** | **112.9** | Supporting |
| **L6: Autonomous Distill** | 195 tokens | **-96.9%** | **100/100** | **+30 pts** | **196.9** | ★ DOMINANT (Distills 8 turns into 195 tokens) |

---

## 2️⃣ Table 2: Progressive Cumulative Stacking Sequence (L0 ➔ L6)

| Layer Stacking Order | Tokens Remaining | Layer Delta | Token Usage Delta (%) | Cumulative Savings % | Answer Quality | QA Quality Delta | CEI Efficiency Index |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| **0. Raw Baseline (No Layers)** | 6,250 tokens | --- | **---** | **0.0%** | **70/100** | **--- (Raw)** | **70.0** |
| **+ L-1: Semantic Cache [Zero-Token Semantic Cache] 🏆** | 6,250 tokens | 0 | **0.0%** | **-0.0%** | **85/100** | **+15 pts** | **85.0** |
| **+ L0: Code Topology [Graphify] 🏆** | 5,375 tokens | Saved 875 | **-14.0%** | **-14.0%** | **85/100** | **+0 pts** | **96.9** |
| **+ L1.5: Data Lens [Zero-Row Data Lens] 🏆** | 5,375 tokens | 0 | **0.0%** | **-14.0%** | **90/100** | **+5 pts** | **102.6** |
| **+ L1: Ponytail [Ponytail] ** | 5,100 tokens | Saved 275 | **-5.1%** | **-18.4%** | **90/100** | **+0 pts** | **106.6** |
| **+ L2: Caveman [Caveman] 🏆** | 5,050 tokens | Saved 50 | **-1.0%** | **-19.2%** | **90/100** | **+0 pts** | **107.3** |
| **+ L3: RTK [RTK (Rust Token Killer)] 🏆** | 5,050 tokens | 0 | **0.0%** | **-19.2%** | **90/100** | **+0 pts** | **107.3** |
| **+ L4: Headroom [Headroom Proxy] 🏆** | 4,200 tokens | Saved 850 | **-16.8%** | **-32.8%** | **90/100** | **+0 pts** | **119.5** |
| **+ L5: Knowledge Memory [MemoraX Code] 🏆** | 2,800 tokens | Saved 1,400 | **-33.3%** | **-55.2%** | **95/100** | **+5 pts** | **147.4** |
| **+ L6: Autonomous Distill [OpenViking] 🏆** | 195 tokens | Saved 2,605 | **-93.0%** | **-96.9%** | **100/100** | **+5 pts** | **196.9** |
| **+ L7: Turn Folding [Dynamic Turn Folding] 🏆** | 155 tokens | Saved 40 | **-20.5%** | **-97.5%** | **100/100** | **+0 pts** | **197.5** |
| **+ L8: Loop Breaker [Loop Breaker & Failover] 🏆** | 125 tokens | Saved 30 | **-19.4%** | **-98.0%** | **100/100** | **+0 pts** | **198.0** |
| **+ L9: CoT Governor [CoT Budget Governor] 🏆** | 110 tokens | Saved 15 | **-12.0%** | **-98.2%** | **100/100** | **+0 pts** | **198.2** |
| **+ L10: Model Router [Model Cascading Router] 🏆** | 110 tokens | 0 | **0.0%** | **-98.2%** | **100/100** | **+0 pts** | **198.2** |

---

## 3️⃣ Table 3: Dual Rubric Evaluation

| Category | Verification Checkpoint in Agent Response | Score Weight | Status |
|:---:| :--- | :---: | :---: |
| **Core** | Root cause Attempt A: Optimistic locking causes Timeout under high concurrency | 25 pts | **✅ PASSED** |
| **Core** | Root cause Attempt B: Pessimistic locking causes Deadlock due to reverse table lock order | 25 pts | **✅ PASSED** |
| **Core** | Definitive Fix: Synchronize table locking order or deploy Redis Mutex Distributed Lock | 30 pts | **✅ PASSED** |
| **Bonus** | Recommends configuring Deadlock Detection Timeout to 500ms in Postgres | +10 pts | **🌟 BONUS PASSED** |
| **Bonus** | Provides safe Redis Distributed Lock implementation using Redlock pattern | +10 pts | **🌟 BONUS PASSED** |

> **💡 Total Quality Score:** **100/100 pts** (CEI Index: **198.2 🏆**)
> **Assessment:** *"Condenses 8 debugging loops into a 100% accurate summary, slashing 96.9% of context bloat."*
