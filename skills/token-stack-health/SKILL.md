---
name: token-stack:health
description: Check token-stack health on Windows Claude Code. Use for directory, harness, model, ponytail, caveman, RTK, or Headroom status. Read-only.
user-invocable: true
---

# Token Stack Health

Run bundled PowerShell checker for compact status. It never installs, edits config, starts processes, or prints secrets.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$HOME/.claude/skills/token-stack-health/scripts/token-stack-health.ps1"
```

Use `-Json` for machine-readable output. Use `-ProfileDirectory` to inspect another Claude profile. Use `-SkipRuntimeProbes` when Headroom network probing is not wanted.

Report always includes `directory`, `profile`, `harness`, `model`, and four layers:

- `ponytail`, `caveman`: installed and `enabledPlugins` state.
- `rtk`: shim, binary, and version.
- `headroom`: installed, loopback route, and bounded `/readyz`/`/health` status.

Status meanings: `OK` complete, `WARN` partial, `NO` missing/disabled, `UNKNOWN` unavailable.

Scope: health inspection only. Does NOT install plugins, edit settings, start/stop Headroom, measure savings, or repair failures. Never output API keys, credentials, upstream URLs, prompts, transcripts, or raw environment/config dumps.

