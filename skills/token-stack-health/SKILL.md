---
name: token-stack:health
description: Check token-stack health on Windows (Claude Code / Codex / Kimi). Inspects harness, model, ponytail, caveman, RTK, Headroom, and optional Layer 5 Memory status. Read-only.
user-invocable: true
---

# Token Stack Health

Run bundled PowerShell checker for 4 Core Layers + Optional Layer 5 Memory status:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$HOME/.codex/skills/token-stack-health/scripts/token-stack-health.ps1"
```

The script is safe and read-only: it probes the local loopback proxy (`/readyz`) and checks configured memory providers without modifying settings or printing secret values.

Use `-Json` for machine-readable output. Use `-ProfileDirectory` to inspect another profile directory.