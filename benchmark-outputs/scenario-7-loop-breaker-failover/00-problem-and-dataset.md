# 📋 Scenario #7: Task Specification & Public Ground Truth Dataset

## 1. Task Information
- **Title:** Scenario 7: Test Doom Loop Interception & Sub-500ms Waterfall Failover
- **Objective:** Detect and halt circular test retries and transparently failover when primary provider quota returns HTTP 429.
- **Prompt:** "Run failing test suite for distributed lock, detect repetitive 3x circular edits, halt runaway spend, and transparently failover from exhausted Alibaba quota to Kimi Code."

## 2. Public Ground Truth Dataset
- **GitHub Repository:** [princeton-nlp/SWE-bench](https://github.com/princeton-nlp/SWE-bench)
- **Dataset Category:** SWE-bench Agent Loop Failure & Alibaba Quota 429
- **Raw Context Volume:** 12,500 tokens
- **Dominant Optimization Layer:** **L8: Loop Breaker (-80.0%)**
