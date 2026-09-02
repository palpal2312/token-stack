# 📊 Evaluation Metrics: Scenario #1

> **Title:** Scenario 1: Repository Architecture Survey & Data Flow Analysis
> **Public Source:** [hagopj13/node-express-boilerplate](https://github.com/hagopj13/node-express-boilerplate)

---

## 1️⃣ Table 1: Single Layer Isolated Efficiency

| Optimization Layer | Tokens Remaining | Token Usage Delta (%) | Answer Quality | QA Quality Delta | CEI Efficiency Index | Notes |
| :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| **Raw Baseline (No Layers)** | 4,247 tokens | **0.0%** | **90/100** | **0 pts (Raw)** | **90.0** | Raw baseline |
| **L0: Code Topology** | 363 tokens | **-91.5%** | **100/100** | **+10 pts** | **191.5** | ★ DOMINANT (Prunes 95% files) |
| **L1: Ponytail** | 4,118 tokens | **-3.0%** | **90/100** | **0 pts** | **92.7** | Supporting |
| **L2: Caveman** | 4,247 tokens | **0.0%** | **90/100** | **0 pts** | **90.0** | Neutral |
| **L3: RTK** | 4,275 tokens | **+0.7%** | **90/100** | **0 pts** | **90.0** | ⚠️ Slight log header overhead |
| **L4: Headroom** | 4,247 tokens | **0.0%** | **90/100** | **0 pts** | **90.0** | Neutral |
| **L5: Knowledge Memory** | 4,282 tokens | **+0.8%** | **100/100** | **+10 pts** | **100.0** | ⚠️ Injects memory slot |
| **L6: Autonomous Distill** | 4,272 tokens | **+0.6%** | **100/100** | **+10 pts** | **100.0** | ⚠️ Injects prefix summary |

---

## 2️⃣ Table 2: Progressive Cumulative Stacking Sequence (L0 ➔ L6)

| Layer Stacking Order | Tokens Remaining | Layer Delta | Token Usage Delta (%) | Cumulative Savings % | Answer Quality | QA Quality Delta | CEI Efficiency Index |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| **0. Raw Baseline (No Layers)** | 4,247 tokens | --- | **---** | **0.0%** | **90/100** | **--- (Raw)** | **90.0** |
| **+ L-1: Semantic Cache [Zero-Token Semantic Cache] 🏆** | 4,247 tokens | 0 | **0.0%** | **-0.0%** | **100/100** | **+10 pts** | **100.0** |
| **+ L0: Code Topology [Graphify] 🏆** | 363 tokens | Saved 3,884 | **-91.5%** | **-91.5%** | **100/100** | **+0 pts** | **191.5** |
| **+ L1.5: Data Lens [Zero-Row Data Lens] 🏆** | 363 tokens | 0 | **0.0%** | **-91.5%** | **100/100** | **+0 pts** | **191.5** |
| **+ L1: Ponytail [Ponytail] ** | 363 tokens | 0 | **0.0%** | **-91.5%** | **100/100** | **+0 pts** | **191.5** |
| **+ L2: Caveman [Caveman] 🏆** | 363 tokens | 0 | **0.0%** | **-91.5%** | **100/100** | **+0 pts** | **191.5** |
| **+ L3: RTK [RTK (Rust Token Killer)] 🏆** | 363 tokens | 0 | **0.0%** | **-91.5%** | **100/100** | **+0 pts** | **191.5** |
| **+ L4: Headroom [Headroom Proxy] 🏆** | 363 tokens | 0 | **0.0%** | **-91.5%** | **100/100** | **+0 pts** | **191.5** |
| **+ L5: Knowledge Memory [MemoraX Code] 🏆** | 398 tokens | +35 (Overhead) | **+9.6%** | **-90.6%** | **100/100** | **+0 pts** | **190.6** |
| **+ L6: Autonomous Distill [OpenViking] 🏆** | 423 tokens | +25 (Overhead) | **+6.3%** | **-90.0%** | **100/100** | **+0 pts** | **190.0** |
| **+ L7: Turn Folding [Dynamic Turn Folding] 🏆** | 373 tokens | Saved 50 | **-11.8%** | **-91.2%** | **100/100** | **+0 pts** | **191.2** |
| **+ L8: Loop Breaker [Loop Breaker & Failover] 🏆** | 373 tokens | 0 | **0.0%** | **-91.2%** | **100/100** | **+0 pts** | **191.2** |
| **+ L9: CoT Governor [CoT Budget Governor] 🏆** | 298 tokens | Saved 75 | **-20.1%** | **-93.0%** | **100/100** | **+0 pts** | **193.0** |
| **+ L10: Model Router [Model Cascading Router] 🏆** | 298 tokens | 0 | **0.0%** | **-93.0%** | **100/100** | **+0 pts** | **193.0** |

---

## 3️⃣ Table 3: Dual Rubric Evaluation

| Category | Verification Checkpoint in Agent Response | Score Weight | Status |
|:---:| :--- | :---: | :---: |
| **Core** | Runtime & Framework: Node.js 20 + Express 4.x + TypeScript Strict | 20 pts | **✅ PASSED** |
| **Core** | Data & Cache Layer: PostgreSQL (pg-pool) + Redis Session Store | 20 pts | **✅ PASSED** |
| **Core** | Auth Flow: JWT HS256 (Access 15m) + Redis Refresh Token (7d) | 20 pts | **✅ PASSED** |
| **Core** | API Endpoints: Accurately lists routes (/auth/login, /auth/refresh, /user/profile) | 20 pts | **✅ PASSED** |
| **Bonus** | Identified connection leak in UserService when query returns 0 rows | +10 pts | **🌟 BONUS PASSED** |
| **Bonus** | Recommended Graceful Shutdown hook closing Pool on SIGTERM | +10 pts | **🌟 BONUS PASSED** |

> **💡 Total Quality Score:** **100/100 pts** (CEI Index: **193.0 🏆**)
> **Assessment:** *"100% accurate architectural discovery with proactive leak detection."*
