---
name: token-stack:health
description: Live health checker probing all 7 layers of the Token & Context Engine.
---

# Token Stack Health

Probes harness, model configuration, Layer 0 topology, Layers 1-4 in-flight token reducers, Layer 5 harvester, and Layer 6 context database.

## Usage
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\skills\token-stack-health\scripts\token-stack-health.ps1
```