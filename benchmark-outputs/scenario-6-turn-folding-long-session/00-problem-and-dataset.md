# 📋 Scenario #6: Task Specification & Public Ground Truth Dataset

## 1. Task Information
- **Title:** Scenario 6: 25-Turn Full-Stack Refactoring & Cold Context Compaction
- **Objective:** Refactor backend authentication service across 25 turns without mid-session context explosion or 429 TPM exhaustion.
- **Prompt:** "Perform a multi-stage authentication refactor across 25 turns: migrate from express-session to stateless JWT, update 12 route handlers, and ensure earlier 1,200-line tool outputs are cleanly folded."

## 2. Public Ground Truth Dataset
- **GitHub Repository:** [cline/cline#1042](https://github.com/cline/cline/issues/1042)
- **Dataset Category:** Long-Horizon Multi-Turn Transcript (25 turns)
- **Raw Context Volume:** 18,500 tokens
- **Dominant Optimization Layer:** **L7: Turn Folding (-88.5%)**
