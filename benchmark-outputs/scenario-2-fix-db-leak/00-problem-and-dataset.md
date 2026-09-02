# 📋 Scenario #2: Task Specification & Public Ground Truth Dataset

## 1. Task Information
- **Title:** Scenario 2: Database Connection Pool Leak Bugfix (TDD Test Suite & Git Patch Diff)
- **Objective:** Execute integration tests, identify client connection leak on empty query results, fix in finally block, and filter CLI logs.
- **Prompt:** "Run the test suite for UserService: diagnose the connection pool leak when queries return 0 rows, fix the bug ensuring all 25 integration tests PASS, and generate a concise Git Patch Diff."

## 2. Public Ground Truth Dataset
- **GitHub Repository:** [gothinkster/node-express-realworld-example-app](https://github.com/gothinkster/node-express-realworld-example-app)
- **Dataset Category:** RealWorld Backend Bug #104 (SWE-bench / GitHub Issues)
- **Raw Context Volume:** 4,250 tokens
- **Dominant Optimization Layer:** **L3: RTK (-54.7%) & L2: Caveman (-69.5%)**
