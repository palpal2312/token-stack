# Example 06: SkillRouter at Scale (Anti-Skill-Shadowing & Top-K Reranking)

## 📌 Research & Theory Background
Based on groundbreaking research from:
1. **arXiv:2603.22455** — *"SkillRouter: Skill Routing for LLM Agents at Scale"* (Alibaba Group / `zhengyanzhao1997/SkillRouter`)
2. **arXiv:2605.24050** — *"More Skills, Worse Agents? Skill Shadowing Degrades Performance When Expanding Skill Libraries"*
3. **arXiv:2606.10388** — *"Right Family, Wrong Skill: Benchmarking Risk Exposure in Agent Skill Retrieval"*
4. **`benchflow-ai/skillsbench`** — Multi-domain LLM agent skill benchmark

## 🚨 The Dilemma: Prompt Bloat & Skill Shadowing
In modern AI agent platforms (e.g., Claude Code, AgentKit, Codex), agents accumulate 80 to 250+ community and project skills.
* **Without SkillRouter (Baseline)**:
  - The runtime injects the name, description, and schema of all 240+ skills into the system prompt.
  - **36,450+ tokens** are burned in *every single turn* just to remind the model what skills exist!
  - **Skill Shadowing (arXiv:2605.24050)** occurs: Overlapping skills (e.g., `ck:git` vs `ak:git` vs `ghpm`, or `ck:test` vs `ck:web-testing`) confuse the LLM, leading to wrong tool invocations and hallucinations (31–44% accuracy degradation).
* **With Layer 0.5 SkillRouter**:
  - Intercepts the user query before prompt construction.
  - **Stage 1 (Fast Retrieval)**: Lexical BM25 + N-Gram Sparse Vector similarity trims 240+ skills down to Top-10 candidates (<5ms).
  - **Stage 2 (Body-Aware Reranker)**: Deep-inspects skill implementation bodies (commands, tools, scripts) to eliminate "Harmful Siblings" (arXiv:2606.10388) and select the **Top-K (1–3) active skills**.
  - Generates a compact Active Skill Injection block (<180 tokens).
  - **Result**: **-99.6% Prompt Bloat Reduction** and **100% Hit@1 accuracy**.

## 🚀 How to Run

```bash
node examples/06-skill-router-at-scale/run-example.cjs
```
