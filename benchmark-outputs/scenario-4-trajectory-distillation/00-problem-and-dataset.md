# 📋 Scenario #4: Task Specification & Public Ground Truth Dataset

## 1. Task Information
- **Title:** Scenario 4: Multi-Turn Trajectory Distillation (8-Turn Failure Recovery)
- **Objective:** Distill 8 rounds of consecutive debugging attempts (Optimistic timeout vs Pessimistic deadlock) into a single actionable root-cause summary.
- **Prompt:** "After 8 unsuccessful debugging attempts (Optimistic locking causing timeout, Pessimistic locking causing deadlocks), distill the current state and provide the definitive resolution."

## 2. Public Ground Truth Dataset
- **GitHub Repository:** [THUIR/MemoryBench-LeaderBoard](https://github.com/THUIR/MemoryBench-LeaderBoard)
- **Dataset Category:** task_Long-Long.json (Multi-turn trajectory state condensation)
- **Raw Context Volume:** 6,250 tokens
- **Dominant Optimization Layer:** **L6: OpenViking (-93.0% Trajectory Compaction)**
