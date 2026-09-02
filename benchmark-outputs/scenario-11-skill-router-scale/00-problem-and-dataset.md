# 📋 Scenario #11: Task Specification & Public Ground Truth Dataset

## 1. Task Information
- **Title:** Scenario 11: Scale-Out Agent Skill Routing & Anti-Skill-Shadowing
- **Objective:** Route user intent across 240+ multi-domain skills (arXiv:2603.22455 & SkillsBench), eliminating 36,000+ tokens of prompt bloat and preventing tool hallucination.
- **Prompt:** "Given a library of 243 active agent skills, route the user task ("Stage modified TypeScript files, create conventional commit, and open GitHub PR") to the optimal Top-K skills without dumping all 240+ tool schemas into the LLM system prompt."

## 2. Public Ground Truth Dataset
- **GitHub Repository:** [zhengyanzhao1997/SkillRouter](https://github.com/zhengyanzhao1997/SkillRouter)
- **Dataset Category:** SkillsBench & ToolBench 80k-Scale Skill Catalog (arXiv:2603.22455)
- **Raw Context Volume:** 36,450 tokens
- **Dominant Optimization Layer:** **L0.5: Skill Router (-99.4%)**
