# 📋 Scenario #3: Task Specification & Public Ground Truth Dataset

## 1. Task Information
- **Title:** Scenario 3: Cross-Session Architecture Standard Recall (Episodic Memory Task)
- **Objective:** Retrieve UUID primary key convention and AppError standard from a previous conversation session without reloading raw history.
- **Prompt:** "In a new work session (Session 2), recall the database primary key standard and error handling pattern established previously to implement the next feature module."

## 2. Public Ground Truth Dataset
- **GitHub Repository:** [THUIR/MemoryBench-LeaderBoard](https://github.com/THUIR/MemoryBench-LeaderBoard)
- **Dataset Category:** task_Long-Short.json (Long history -> Short precision recall)
- **Raw Context Volume:** 6,250 tokens
- **Dominant Optimization Layer:** **L5: MemoraX (-99.3%) & L4: Headroom (-86.0%)**
