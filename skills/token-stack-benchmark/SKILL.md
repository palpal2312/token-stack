---
name: token-stack:benchmark
description: Run multi-layer empirical token benchmarks comparing isolated layers vs cumulative 7-layer stack on realistic scenarios.
---

# Token Stack Benchmark

Evaluates and benchmarks token consumption across all 7 layers of the Token Stack using standardized scenarios from `examples/`.

## Features
- **Isolated Single-Layer Mode**: Measures baseline vs each layer operating independently.
- **Cumulative Progressive Mode**: Measures cumulative compounding token reduction (`L0` -> `L0..1` -> `L0..2` -> ... -> `L0..6`).
- **Multi-run Averaging**: Computes arithmetic mean across $N$ iterations (default: 3) to eliminate LLM non-determinism.
- **Layer Exclusion**: Allows excluding specific layers (`-ExcludeLayers 4`).

## Usage

```powershell
# Run benchmark on multi-file bugfix with 3 iterations
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\skills\token-stack-benchmark\scripts\token-stack-benchmark.ps1 `
  -Example 01-multi-file-bugfix `
  -Iterations 3

# Run on large CLI test run excluding Headroom proxy (Layer 4)
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\skills\token-stack-benchmark\scripts\token-stack-benchmark.ps1 `
  -Example 02-large-cli-test-run `
  -ExcludeLayers 4 `
  -Iterations 5
```