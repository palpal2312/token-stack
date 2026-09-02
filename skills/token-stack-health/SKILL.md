---
name: token-stack:health
description: Live health checker and doctor diagnostic probes inspecting all 14 layers of the Token & Context Engine. Use for doctor, diagnostics, port readiness, and daemon checks.
---

# Token Stack Health

Probes harness, model configuration, Layer -1 Semantic Cache, Layer 0 Model Router, Layer 0.5 Skill Router, Layer 1 Topology, Layer 1.5 Data Lens, Layers 2-4 in-flight reducers, Layer 5 Turn Folding, Layer 6 CoT Governor, Layer 7 Loop Breaker, Layer 8 Headroom Proxy, Layer 9 MemoraX Harvester, and Layer 10 Context Database.

## Usage
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\skills\token-stack-health\scripts\token-stack-health.ps1
```