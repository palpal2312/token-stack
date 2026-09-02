# 📊 Evaluation Metrics: Scenario #8

> **Title:** Scenario 8: 1-Line Typo Fix with CoT Budget Throttling (Extended Thinking)
> **Public Source:** [anthropics/anthropic-sdk-typescript](https://github.com/anthropics/anthropic-sdk-typescript)

---

## 1️⃣ Table 1: Single Layer Isolated Efficiency

| Optimization Layer | Tokens Remaining | Token Usage Delta (%) | Answer Quality | QA Quality Delta | CEI Efficiency Index | Notes |
| :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| **Raw Baseline (No Layers)** | 8,200 tokens | **0.0%** | **85/100** | **0 pts (Raw)** | **85.0** | Raw baseline |
| **L9: CoT Governor** | 800 tokens | **-90.2%** | **100/100** | **+15 pts** | **190.2** | ★ DOMINANT (Throttles 8k thinking tokens to 1k) |

---

## 2️⃣ Table 2: Progressive Cumulative Stacking Sequence (L0 ➔ L6)

| Layer Stacking Order | Tokens Remaining | Layer Delta | Token Usage Delta (%) | Cumulative Savings % | Answer Quality | QA Quality Delta | CEI Efficiency Index |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| **0. Raw Baseline (No Layers)** | 8,200 tokens | --- | **---** | **0.0%** | **85/100** | **--- (Raw)** | **85.0** |
| **+ L-1: Semantic Cache [Zero-Token Semantic Cache] 🏆** | 8,200 tokens | 0 | **0.0%** | **-0.0%** | **100/100** | **+15 pts** | **100.0** |
| **+ L0: Code Topology [Graphify] 🏆** | 7,800 tokens | Saved 400 | **-4.9%** | **-4.9%** | **100/100** | **+0 pts** | **104.9** |
| **+ L1.5: Data Lens [Zero-Row Data Lens] 🏆** | 7,800 tokens | 0 | **0.0%** | **-4.9%** | **100/100** | **+0 pts** | **104.9** |
| **+ L1: Ponytail [Ponytail] ** | 7,750 tokens | Saved 50 | **-0.6%** | **-5.5%** | **100/100** | **+0 pts** | **105.5** |
| **+ L2: Caveman [Caveman] 🏆** | 7,550 tokens | Saved 200 | **-2.6%** | **-7.9%** | **100/100** | **+0 pts** | **107.9** |
| **+ L3: RTK [RTK (Rust Token Killer)] 🏆** | 7,550 tokens | 0 | **0.0%** | **-7.9%** | **100/100** | **+0 pts** | **107.9** |
| **+ L4: Headroom [Headroom Proxy] 🏆** | 7,550 tokens | 0 | **0.0%** | **-7.9%** | **100/100** | **+0 pts** | **107.9** |
| **+ L5: Knowledge Memory [MemoraX Code] 🏆** | 7,550 tokens | 0 | **0.0%** | **-7.9%** | **100/100** | **+0 pts** | **107.9** |
| **+ L6: Autonomous Distill [OpenViking] 🏆** | 7,550 tokens | 0 | **0.0%** | **-7.9%** | **100/100** | **+0 pts** | **107.9** |
| **+ L7: Turn Folding [Dynamic Turn Folding] 🏆** | 7,550 tokens | 0 | **0.0%** | **-7.9%** | **100/100** | **+0 pts** | **107.9** |
| **+ L8: Loop Breaker [Loop Breaker & Failover] 🏆** | 7,550 tokens | 0 | **0.0%** | **-7.9%** | **100/100** | **+0 pts** | **107.9** |
| **+ L9: CoT Governor [CoT Budget Governor] 🏆** | 150 tokens | Saved 7,400 | **-98.0%** | **-98.2%** | **100/100** | **+0 pts** | **198.2** |
| **+ L10: Model Router [Model Cascading Router] 🏆** | 150 tokens | 0 | **0.0%** | **-98.2%** | **100/100** | **+0 pts** | **198.2** |

---

## 3️⃣ Table 3: Dual Rubric Evaluation

| Category | Verification Checkpoint in Agent Response | Score Weight | Status |
|:---:| :--- | :---: | :---: |
| **Core** | Typo Correction: Replaces Submitt with Submit cleanly | 30 pts | **✅ PASSED** |
| **Core** | Budget Throttling: Automatically injects budget_tokens: 1024 | 30 pts | **✅ PASSED** |
| **Core** | Sub-2s Latency: Delivers complete patch in 1.4 seconds | 20 pts | **✅ PASSED** |
| **Bonus** | Generates unified git diff with zero conversational fluff | +10 pts | **🌟 BONUS PASSED** |
| **Bonus** | Zero hallucinated reasoning scratchpad tokens | +10 pts | **🌟 BONUS PASSED** |

> **💡 Total Quality Score:** **100/100 pts** (CEI Index: **198.2 🏆**)
> **Assessment:** *"Throttled thinking tokens by 90.2%, eliminating 7,400 tokens of redundant chain-of-thought."*
