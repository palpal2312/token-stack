# 📊 Evaluation Metrics: Scenario #3

> **Title:** Scenario 3: Cross-Session Architecture Standard Recall (Episodic Memory Task)
> **Public Source:** [THUIR/MemoryBench-LeaderBoard](https://github.com/THUIR/MemoryBench-LeaderBoard)

---

## 1️⃣ Table 1: Single Layer Isolated Efficiency

| Optimization Layer | Tokens Remaining | Token Usage Delta (%) | Answer Quality | QA Quality Delta | CEI Efficiency Index | Notes |
| :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| **Raw Baseline (No Layers)** | 6,250 tokens | **0.0%** | **75/100** | **0 pts (Raw)** | **75.0** | Raw baseline |
| **L0: Code Topology** | 5,375 tokens | **-14.0%** | **75/100** | **0 pts** | **85.5** | Supporting |
| **L1: Ponytail** | 5,800 tokens | **-7.2%** | **75/100** | **0 pts** | **80.4** | Supporting |
| **L2: Caveman** | 6,200 tokens | **-0.8%** | **75/100** | **0 pts** | **75.6** | Supporting |
| **L3: RTK** | 6,250 tokens | **0.0%** | **75/100** | **0 pts** | **75.0** | Neutral |
| **L4: Headroom** | 1,050 tokens | **-83.2%** | **85/100** | **+10 pts** | **155.7** | ★ DOMINANT (Prompt Cache Hit 90%) |
| **L5: Knowledge Memory** | 45 tokens | **-99.3%** | **100/100** | **+25 pts** | **199.3** | ★ DOMINANT (Precision slot recall) |
| **L6: Autonomous Distill** | 287 tokens | **-95.4%** | **100/100** | **+25 pts** | **195.4** | Supporting |

---

## 2️⃣ Table 2: Progressive Cumulative Stacking Sequence (L0 ➔ L6)

| Layer Stacking Order | Tokens Remaining | Layer Delta | Token Usage Delta (%) | Cumulative Savings % | Answer Quality | QA Quality Delta | CEI Efficiency Index |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| **0. Raw Baseline (No Layers)** | 6,250 tokens | --- | **---** | **0.0%** | **75/100** | **--- (Raw)** | **75.0** |
| **+ L-1: Semantic Cache [Zero-Token Semantic Cache] 🏆** | 6,240 tokens | Saved 10 | **-0.2%** | **-0.2%** | **90/100** | **+15 pts** | **90.1** |
| **+ L0: Code Topology [Graphify] 🏆** | 5,365 tokens | Saved 875 | **-14.0%** | **-14.2%** | **90/100** | **+0 pts** | **102.7** |
| **+ L1: Ponytail [Ponytail] ** | 5,090 tokens | Saved 275 | **-5.1%** | **-18.6%** | **90/100** | **+0 pts** | **106.7** |
| **+ L2: Caveman [Caveman] 🏆** | 5,040 tokens | Saved 50 | **-1.0%** | **-19.4%** | **90/100** | **+0 pts** | **107.4** |
| **+ L3: RTK [RTK (Rust Token Killer)] 🏆** | 5,040 tokens | 0 | **0.0%** | **-19.4%** | **90/100** | **+0 pts** | **107.4** |
| **+ L4: Headroom [Headroom Proxy] 🏆** | 865 tokens | Saved 4,175 | **-82.8%** | **-86.2%** | **90/100** | **+0 pts** | **167.5** |
| **+ L5: Knowledge Memory [MemoraX Code] 🏆** | 35 tokens | Saved 830 | **-96.0%** | **-99.4%** | **100/100** | **+10 pts** | **199.4** |
| **+ L6: Autonomous Distill [OpenViking] 🏆** | 35 tokens | 0 | **0.0%** | **-99.4%** | **100/100** | **+0 pts** | **199.4** |
| **+ L7: Turn Folding [Dynamic Turn Folding] 🏆** | 35 tokens | 0 | **0.0%** | **-99.4%** | **100/100** | **+0 pts** | **199.4** |
| **+ L8: Loop Breaker [Loop Breaker & Failover] 🏆** | 35 tokens | 0 | **0.0%** | **-99.4%** | **100/100** | **+0 pts** | **199.4** |
| **+ L9: CoT Governor [CoT Budget Governor] 🏆** | 35 tokens | 0 | **0.0%** | **-99.4%** | **100/100** | **+0 pts** | **199.4** |
| **+ L10: Model Router [Model Cascading Router] 🏆** | 35 tokens | 0 | **0.0%** | **-99.4%** | **100/100** | **+0 pts** | **199.4** |

---

## 3️⃣ Table 3: Dual Rubric Evaluation

| Category | Verification Checkpoint in Agent Response | Score Weight | Status |
|:---:| :--- | :---: | :---: |
| **Core** | Primary Key Standard: Identifies UUID v4 (no auto-increment ids) | 40 pts | **✅ PASSED** |
| **Core** | Error Handling Pattern: Uses AppError(statusCode, errorCode, message) | 40 pts | **✅ PASSED** |
| **Bonus** | Pinpoints AppError definition location at src/utils/AppError.ts | +10 pts | **🌟 BONUS PASSED** |
| **Bonus** | Provides HTTP Status code mapping matrix (400/401/403/404) | +10 pts | **🌟 BONUS PASSED** |

> **💡 Total Quality Score:** **100/100 pts** (CEI Index: **199.4 🏆**)
> **Assessment:** *"100% precision recall of architectural conventions without reloading 6,250 tokens of history."*
