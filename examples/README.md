# Token Stack Benchmark Scenarios & Runnable Examples (`examples/`)

This directory contains standardized benchmark scenarios and executable verification examples designed to quantify token savings across all 14 layers of Token-Stack 3.2.

## Available Scenarios & Runnable Examples

1. **`01-multi-file-bugfix`**: Measures **Layer 1 (Code Topology - Graphify)** token reduction during codebase scouting across 15+ files vs raw `grep/find`.
2. **`02-large-cli-test-run`**: Measures **Layer 4 (RTK)** terminal log compression on 1,000+ line test outputs.
3. **`03-concise-refactor`**: Measures **Layer 2 (Ponytail)** code brevity and **Layer 3 (Caveman)** unified diff patches.
4. **`04-cross-session-rules`**: Measures **Layer 9 (MemoraX Harvester)** zero-discovery cross-session rule recall.
5. **`05-hierarchical-rag-query`**: Measures **Layer 10 (OpenViking Context DB)** 3-tier L0/L1/L2 progressive context loading vs raw RAG.
6. **`06-skill-router-at-scale`**: Measures **Layer 0.5 (Dynamic Skill Router)** two-stage retrieve & rerank across 240+ skills (`benchflow-ai/skillsbench` & `zhengyanzhao1997/SkillRouter`), slashing prompt bloat from 36,450 to ~200 tokens (-99.4%) and eliminating Skill Shadowing.
7. **`07-quant-clickhouse-datalens`**: Measures **Layer 1.5 (Data Lens - ClickHouse/DuckDB)** columnar profiling on 25,000 tick trade records (`nautechsystems/nautilus_trader` & `tardis-dev`), slashing 360,000+ tokens of raw CSV lines down to a 120-token Data Contract and 65-token Quant Tear-Sheet (-99.95%).

## Running Examples

```bash
# Run Skill Router scale test
node examples/06-skill-router-at-scale/run-example.cjs

# Run Quant ClickHouse DataLens test
node examples/07-quant-clickhouse-datalens/run-example.cjs
```