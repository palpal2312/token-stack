---
name: token-stack
description: Unified router for the 14-Layer Master Token & Context Engine (Semantic Cache, Model Router, Skill Router, Code Topology, Data Lens, Ponytail, Caveman, RTK, Turn Folding, CoT Governor, Loop Breaker, Headroom, MemoraX, OpenViking).
---

# Token Stack Router

Provides unified access to the **14-Layer Master Token & Context Engine**:
- **Layer -1**: Zero-Token Semantic Cache (SQLite N-Gram Cosine similarity, <12ms, 0 tokens)
- **Layer 0**: Model Cascading Router (RouteLLM & Frugal Classifier, -85% routine cost)
- **Layer 0.5**: Dynamic Skill Router (`SkillRouter` - arXiv:2603.22455, arXiv:2605.24050, arXiv:2606.10388: Two-Stage Retrieve & Rerank, Anti-Skill-Shadowing, -98% prompt bloat)
- **Layer 1**: Code Topology (`Graphify`, `GitNexus`, `CodeGraph` - AST navigation)
- **Layer 1.5**: Data & Quant Topology (`DataLens` - DuckDB / ClickHouse Data Contracts & Tear-Sheets)
- **Layer 2**: Code Reduction (`Ponytail` - Anti-boilerplate, KISS, YAGNI)
- **Layer 3**: Word Reduction (`Caveman` - Concise responses & Git patch diffs)
- **Layer 4**: CLI Output Filter (`RTK` - 60-90% terminal log & test noise reduction)
- **Layer 5**: In-Flight Turn Folding (5-turn Epoch Freezing, preserves prompt cache)
- **Layer 6**: CoT Reasoning Governor (Dynamic task-aware thinking token throttler)
- **Layer 7**: Runaway Loop Breaker & Failover (SHA256 ring buffer + 500ms 429 failover)
- **Layer 8**: Context Proxy (`Headroom` - Lossless HTTP compression & prompt caching)
- **Layer 9**: Knowledge Memory Harvester (`MemoraX Code` - Post-task episodic slots)
- **Layer 10**: Context Database Platform (`OpenViking`, `Obsidian Vault` - L0/L1/L2 storage)

## Sub-Skills
- `token-stack:benchmark` -> Run isolated and cumulative token savings benchmarks across 12 standardized scenarios (14 layers).
- `token-stack:health` -> Run live health probes across all 14 layers.
- `token-stack:setup` -> Configure and install components into profiles.
- `token-stack:report` -> Generate token savings analytics.