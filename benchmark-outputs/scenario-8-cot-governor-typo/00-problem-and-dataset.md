# 📋 Scenario #8: Task Specification & Public Ground Truth Dataset

## 1. Task Information
- **Title:** Scenario 8: 1-Line Typo Fix with CoT Budget Throttling (Extended Thinking)
- **Objective:** Throttle runaway thinking tokens from 8,000 down to 1,024 on a single-character typo fix, cutting latency from 14s to 1.4s.
- **Prompt:** "Fix typo in button label in src/components/SubmitButton.tsx: change "Submitt" to "Submit" ensuring thinking token budget is capped at 1024."

## 2. Public Ground Truth Dataset
- **GitHub Repository:** [anthropics/anthropic-sdk-typescript](https://github.com/anthropics/anthropic-sdk-typescript)
- **Dataset Category:** Extended Thinking Latency Benchmark
- **Raw Context Volume:** 8,200 tokens
- **Dominant Optimization Layer:** **L9: CoT Governor (-90.2%)**
