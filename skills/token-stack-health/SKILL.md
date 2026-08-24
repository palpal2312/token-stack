---
name: token-stack:health
description: Check token-stack health on Windows (Claude Code / Codex / Kimi). Use for directory, harness, model, ponytail, caveman, RTK, or Headroom status. Read-only.
user-invocable: true
---

# Token Stack Health

Run bundled PowerShell checker for full 4-layer status (RTK, Ponytail, Caveman, Headroom):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$HOME/.codex/skills/token-stack-health/scripts/token-stack-health.ps1"
```

The script is safe and read-only: it probes the local loopback proxy (`/readyz`) to report live `[OK]` status, and never installs, edits settings, or prints secret values.

Use `-Json` for machine-readable output. Use `-ProfileDirectory` to explicitly inspect another profile directory.