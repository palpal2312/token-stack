# 📊 Evaluation Metrics: Scenario #11

> **Title:** Scenario 11: Scale-Out Agent Skill Routing & Anti-Skill-Shadowing
> **Public Source:** [zhengyanzhao1997/SkillRouter](https://github.com/zhengyanzhao1997/SkillRouter)

---

## 1️⃣ Table 1: Single Layer Isolated Efficiency

| Optimization Layer | Tokens Remaining | Token Usage Delta (%) | Answer Quality | QA Quality Delta | CEI Efficiency Index | Notes |
| :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| **Raw Baseline (No Layers)** | 36,450 tokens | **0.0%** | **70/100** | **0 pts (Raw)** | **70.0** | Raw baseline (Severe Skill Shadowing) |
| **L0.5: Skill Router** | 235 tokens | **-99.4%** | **100/100** | **+30 pts** | **199.4** | ★ DOMINANT (Two-Stage Retrieve & Rerank in 12ms) |

---

## 2️⃣ Table 2: Progressive Cumulative Stacking Sequence (L0 ➔ L6)

| Layer Stacking Order | Tokens Remaining | Layer Delta | Token Usage Delta (%) | Cumulative Savings % | Answer Quality | QA Quality Delta | CEI Efficiency Index |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| **0. Raw Baseline (No Layers)** | 36,450 tokens | --- | **---** | **0.0%** | **70/100** | **--- (Raw)** | **70.0** |
| **+ L-1: Semantic Cache [Zero-Token Semantic Cache] 🏆** | 36,450 tokens | 0 | **0.0%** | **-0.0%** | **85/100** | **+15 pts** | **85.0** |
| **+ L0: Code Topology [Graphify] 🏆** | 36,450 tokens | 0 | **0.0%** | **-0.0%** | **85/100** | **+0 pts** | **85.0** |
| **+ L0.5: Skill Router [SkillRouter (arXiv:2603.22455)] 🏆** | 235 tokens | Saved 36,215 | **-99.4%** | **-99.4%** | **95/100** | **+10 pts** | **189.4** |
| **+ L1.5: Data Lens [Zero-Row Data Lens] 🏆** | 235 tokens | 0 | **0.0%** | **-99.4%** | **95/100** | **+0 pts** | **189.4** |
| **+ L1: Ponytail [Ponytail] ** | 235 tokens | 0 | **0.0%** | **-99.4%** | **95/100** | **+0 pts** | **189.4** |
| **+ L2: Caveman [Caveman] 🏆** | 235 tokens | 0 | **0.0%** | **-99.4%** | **95/100** | **+0 pts** | **189.4** |
| **+ L3: RTK [RTK (Rust Token Killer)] 🏆** | 235 tokens | 0 | **0.0%** | **-99.4%** | **95/100** | **+0 pts** | **189.4** |
| **+ L4: Headroom [Headroom Proxy] 🏆** | 235 tokens | 0 | **0.0%** | **-99.4%** | **95/100** | **+0 pts** | **189.4** |
| **+ L5: Knowledge Memory [MemoraX Code] 🏆** | 235 tokens | 0 | **0.0%** | **-99.4%** | **95/100** | **+0 pts** | **189.4** |
| **+ L6: Autonomous Distill [OpenViking] 🏆** | 235 tokens | 0 | **0.0%** | **-99.4%** | **100/100** | **+5 pts** | **199.4** |
| **+ L7: Turn Folding [Dynamic Turn Folding] 🏆** | 235 tokens | 0 | **0.0%** | **-99.4%** | **100/100** | **+0 pts** | **199.4** |
| **+ L8: Loop Breaker [Loop Breaker & Failover] 🏆** | 235 tokens | 0 | **0.0%** | **-99.4%** | **100/100** | **+0 pts** | **199.4** |
| **+ L9: CoT Governor [CoT Budget Governor] 🏆** | 235 tokens | 0 | **0.0%** | **-99.4%** | **100/100** | **+0 pts** | **199.4** |
| **+ L10: Model Router [Model Cascading Router] 🏆** | 235 tokens | 0 | **0.0%** | **-99.4%** | **100/100** | **+0 pts** | **199.4** |

---

## 3️⃣ Table 3: Dual Rubric Evaluation

| Category | Verification Checkpoint in Agent Response | Score Weight | Status |
|:---:| :--- | :---: | :---: |
| **Core** | Two-Stage Retrieval: N-Gram candidate filtering to Top-10 in <5ms | 25 pts | **✅ PASSED** |
| **Core** | Body-Aware Reranker: Matches command signature `git commit` and `pr` in skill body | 30 pts | **✅ PASSED** |
| **Core** | Anti-Skill-Shadowing: Successfully disambiguates ck:git vs ak:git vs ghpm | 25 pts | **✅ PASSED** |
| **Bonus** | Zero-Bloat Injection: Delivers active skill context under 250 tokens | +10 pts | **🌟 BONUS PASSED** |
| **Bonus** | 100% Hit@1 Precision: Selects exact git skill without unrouted tool hallucinations | +10 pts | **🌟 BONUS PASSED** |

> **💡 Total Quality Score:** **100/100 pts** (CEI Index: **199.4 🏆**)
> **Assessment:** *"Eliminated 36,215 tokens of prompt bloat, resolved skill shadowing with 100% Hit@1 accuracy."*
