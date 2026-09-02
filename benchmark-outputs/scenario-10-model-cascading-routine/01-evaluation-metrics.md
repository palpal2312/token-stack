# 📊 Evaluation Metrics: Scenario #10

> **Title:** Scenario 10: High-Frequency Routine Task Cascading & Frugal Routing
> **Public Source:** [lmsys/RouteLLM](https://github.com/lmsys/RouteLLM)

---

## 1️⃣ Table 1: Single Layer Isolated Efficiency

| Optimization Layer | Tokens Remaining | Token Usage Delta (%) | Answer Quality | QA Quality Delta | CEI Efficiency Index | Notes |
| :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| **Raw Baseline (No Layers)** | 14,000 tokens | **0.0%** | **80/100** | **0 pts (Raw)** | **80.0** | Raw baseline |
| **L10: Model Router** | 400 tokens | **-97.1%** | **100/100** | **+20 pts** | **197.1** | ★ DOMINANT (Routes to fast cheap tier) |

---

## 2️⃣ Table 2: Progressive Cumulative Stacking Sequence (L0 ➔ L6)

| Layer Stacking Order | Tokens Remaining | Layer Delta | Token Usage Delta (%) | Cumulative Savings % | Answer Quality | QA Quality Delta | CEI Efficiency Index |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| **0. Raw Baseline (No Layers)** | 14,000 tokens | --- | **---** | **0.0%** | **80/100** | **--- (Raw)** | **80.0** |
| **+ L-1: Semantic Cache [Zero-Token Semantic Cache] 🏆** | 14,000 tokens | 0 | **0.0%** | **-0.0%** | **95/100** | **+15 pts** | **95.0** |
| **+ L0: Code Topology [Graphify] 🏆** | 10,000 tokens | Saved 4,000 | **-28.6%** | **-28.6%** | **95/100** | **+0 pts** | **122.1** |
| **+ L1.5: Data Lens [Zero-Row Data Lens] 🏆** | 10,000 tokens | 0 | **0.0%** | **-28.6%** | **100/100** | **+5 pts** | **128.6** |
| **+ L1: Ponytail [Ponytail] ** | 9,400 tokens | Saved 600 | **-6.0%** | **-32.9%** | **100/100** | **+0 pts** | **132.9** |
| **+ L2: Caveman [Caveman] 🏆** | 8,200 tokens | Saved 1,200 | **-12.8%** | **-41.4%** | **100/100** | **+0 pts** | **141.4** |
| **+ L3: RTK [RTK (Rust Token Killer)] 🏆** | 7,400 tokens | Saved 800 | **-9.8%** | **-47.1%** | **100/100** | **+0 pts** | **147.1** |
| **+ L4: Headroom [Headroom Proxy] 🏆** | 7,400 tokens | 0 | **0.0%** | **-47.1%** | **100/100** | **+0 pts** | **147.1** |
| **+ L5: Knowledge Memory [MemoraX Code] 🏆** | 7,400 tokens | 0 | **0.0%** | **-47.1%** | **100/100** | **+0 pts** | **147.1** |
| **+ L6: Autonomous Distill [OpenViking] 🏆** | 7,400 tokens | 0 | **0.0%** | **-47.1%** | **100/100** | **+0 pts** | **147.1** |
| **+ L7: Turn Folding [Dynamic Turn Folding] 🏆** | 6,400 tokens | Saved 1,000 | **-13.5%** | **-54.3%** | **100/100** | **+0 pts** | **154.3** |
| **+ L8: Loop Breaker [Loop Breaker & Failover] 🏆** | 6,400 tokens | 0 | **0.0%** | **-54.3%** | **100/100** | **+0 pts** | **154.3** |
| **+ L9: CoT Governor [CoT Budget Governor] 🏆** | 5,200 tokens | Saved 1,200 | **-18.8%** | **-62.9%** | **100/100** | **+0 pts** | **162.9** |
| **+ L10: Model Router [Model Cascading Router] 🏆** | 400 tokens | Saved 4,800 | **-92.3%** | **-97.1%** | **100/100** | **+0 pts** | **197.1** |

---

## 3️⃣ Table 3: Dual Rubric Evaluation

| Category | Verification Checkpoint in Agent Response | Score Weight | Status |
|:---:| :--- | :---: | :---: |
| **Core** | Intent Classification: Correctly routes routine turn to Cheap Tier | 30 pts | **✅ PASSED** |
| **Core** | Conventional Commit: Produces feat(auth): migrate to JWT token store | 25 pts | **✅ PASSED** |
| **Core** | CSS Formatting: Cleans layout flexbox rules accurately | 25 pts | **✅ PASSED** |
| **Bonus** | Cost Reduction Verified: Demonstrates 85% expenditure reduction | +10 pts | **🌟 BONUS PASSED** |
| **Bonus** | Quality Parity: Delivers 100% equivalent code to flagship model | +10 pts | **🌟 BONUS PASSED** |

> **💡 Total Quality Score:** **100/100 pts** (CEI Index: **197.1 🏆**)
> **Assessment:** *"Routed routine commit and formatting to Kimi Code, saving 85% cost with zero quality drop."*
