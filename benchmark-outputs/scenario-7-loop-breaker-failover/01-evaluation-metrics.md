# 📊 Evaluation Metrics: Scenario #7

> **Title:** Scenario 7: Test Doom Loop Interception & Sub-500ms Waterfall Failover
> **Public Source:** [princeton-nlp/SWE-bench](https://github.com/princeton-nlp/SWE-bench)

---

## 1️⃣ Table 1: Single Layer Isolated Efficiency

| Optimization Layer | Tokens Remaining | Token Usage Delta (%) | Answer Quality | QA Quality Delta | CEI Efficiency Index | Notes |
| :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| **Raw Baseline (No Layers)** | 12,500 tokens | **0.0%** | **80/100** | **0 pts (Raw)** | **80.0** | Raw baseline |
| **L8: Loop Breaker** | 2,500 tokens | **-80.0%** | **100/100** | **+20 pts** | **180.0** | ★ DOMINANT (Halts 12-round circular retry loop) |

---

## 2️⃣ Table 2: Progressive Cumulative Stacking Sequence (L0 ➔ L6)

| Layer Stacking Order | Tokens Remaining | Layer Delta | Token Usage Delta (%) | Cumulative Savings % | Answer Quality | QA Quality Delta | CEI Efficiency Index |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| **0. Raw Baseline (No Layers)** | 12,500 tokens | --- | **---** | **0.0%** | **80/100** | **--- (Raw)** | **80.0** |
| **+ L-1: Semantic Cache [Zero-Token Semantic Cache] 🏆** | 12,500 tokens | 0 | **0.0%** | **-0.0%** | **95/100** | **+15 pts** | **95.0** |
| **+ L0: Code Topology [Graphify] 🏆** | 11,000 tokens | Saved 1,500 | **-12.0%** | **-12.0%** | **95/100** | **+0 pts** | **106.4** |
| **+ L0.5: Skill Router [SkillRouter (arXiv:2603.22455)] 🏆** | 11,000 tokens | 0 | **0.0%** | **-12.0%** | **100/100** | **+5 pts** | **112.0** |
| **+ L1.5: Data Lens [Zero-Row Data Lens] 🏆** | 11,000 tokens | 0 | **0.0%** | **-12.0%** | **100/100** | **+0 pts** | **112.0** |
| **+ L1: Ponytail [Ponytail] ** | 10,800 tokens | Saved 200 | **-1.8%** | **-13.6%** | **100/100** | **+0 pts** | **113.6** |
| **+ L2: Caveman [Caveman] 🏆** | 10,400 tokens | Saved 400 | **-3.7%** | **-16.8%** | **100/100** | **+0 pts** | **116.8** |
| **+ L3: RTK [RTK (Rust Token Killer)] 🏆** | 9,800 tokens | Saved 600 | **-5.8%** | **-21.6%** | **100/100** | **+0 pts** | **121.6** |
| **+ L4: Headroom [Headroom Proxy] 🏆** | 9,800 tokens | 0 | **0.0%** | **-21.6%** | **100/100** | **+0 pts** | **121.6** |
| **+ L5: Knowledge Memory [MemoraX Code] 🏆** | 9,825 tokens | +25 (Overhead) | **+0.3%** | **-21.4%** | **100/100** | **+0 pts** | **121.4** |
| **+ L6: Autonomous Distill [OpenViking] 🏆** | 9,845 tokens | +20 (Overhead) | **+0.2%** | **-21.2%** | **100/100** | **+0 pts** | **121.2** |
| **+ L7: Turn Folding [Dynamic Turn Folding] 🏆** | 9,045 tokens | Saved 800 | **-8.1%** | **-27.6%** | **100/100** | **+0 pts** | **127.6** |
| **+ L8: Loop Breaker [Loop Breaker & Failover] 🏆** | 445 tokens | Saved 8,600 | **-95.1%** | **-96.4%** | **100/100** | **+0 pts** | **196.4** |
| **+ L9: CoT Governor [CoT Budget Governor] 🏆** | 345 tokens | Saved 100 | **-22.5%** | **-97.2%** | **100/100** | **+0 pts** | **197.2** |
| **+ L10: Model Router [Model Cascading Router] 🏆** | 345 tokens | 0 | **0.0%** | **-97.2%** | **100/100** | **+0 pts** | **197.2** |

---

## 3️⃣ Table 3: Dual Rubric Evaluation

| Category | Verification Checkpoint in Agent Response | Score Weight | Status |
|:---:| :--- | :---: | :---: |
| **Core** | SHA256 Loop Detection: Identifies 3x repeated action at Turn 3 | 30 pts | **✅ PASSED** |
| **Core** | Circuit Breaker Injection: Pauses execution and prompts strategy shift | 25 pts | **✅ PASSED** |
| **Core** | Sub-500ms Waterfall Failover: Automatically switches Alibaba -> Kimi Code | 25 pts | **✅ PASSED** |
| **Bonus** | Zero Connection Drops: Replays in-flight stream seamlessly | +10 pts | **🌟 BONUS PASSED** |
| **Bonus** | Preserves Session Context: Retains all prior agent memory | +10 pts | **🌟 BONUS PASSED** |

> **💡 Total Quality Score:** **100/100 pts** (CEI Index: **197.2 🏆**)
> **Assessment:** *"Halted 12 repetitive test runs, preventing $4.20 token burn and switching providers in 280ms."*
