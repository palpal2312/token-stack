# Token Stack Benchmark Scenarios (`examples/`)

This directory contains standardized benchmark scenarios designed to quantify token savings across all 7 layers of the Token Stack.

## Available Scenarios

1. **`01-multi-file-bugfix`**: Measures **Layer 0 (Code Topology)** token reduction during codebase scouting across 15+ files vs raw `grep/find`.
2. **`02-large-cli-test-run`**: Measures **Layer 3 (RTK)** terminal log compression on 1,000+ line test outputs.
3. **`03-concise-refactor`**: Measures **Layer 1 (Ponytail)** code brevity and **Layer 2 (Caveman)** word reduction.
4. **`04-cross-session-rules`**: Measures **Layer 5 (MemoraX Harvester)** zero-discovery cross-session rule recall.
5. **`05-hierarchical-rag-query`**: Measures **Layer 6 (OpenViking Context DB)** 3-tier L0/L1/L2 progressive context loading vs raw RAG.

## Running Benchmarks

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\skills\token-stack-benchmark\scripts\token-stack-benchmark.ps1 `
  -Example 01-multi-file-bugfix `
  -Iterations 3
```