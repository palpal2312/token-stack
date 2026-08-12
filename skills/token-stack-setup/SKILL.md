---
name: token-stack:setup
description: Install and configure ponytail, caveman, RTK, and Headroom for a Claude profile. Use only when setup or repair is requested.
user-invocable: true
---

# Token Stack Setup

This setup installs/configures only three layers in-session: RTK, caveman, and ponytail. Do **not** install Headroom in this session; another agent must handle it. Headroom setup can crash a live session when base URL, upstream, or startup hook is wrong.

Run dry-run first:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .claude/skills/token-stack-setup/scripts/token-stack-setup.ps1
```

Apply only after explicit confirmation:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .claude/skills/token-stack-setup/scripts/token-stack-setup.ps1 -Apply
```

Pass `-ProfileDirectory` for another profile. Script installs/enables caveman and ponytail, checks RTK, and never installs, starts, stops, or configures Headroom.

If Headroom is intentionally configured later, edit `.env` or profile settings **by hand**, after backing up and closing Claude Code:

```dotenv
ANTHROPIC_BASE_URL=http://127.0.0.1:8787
```

Then have the dedicated Headroom agent configure the proxy upstream and startup hook. Do not add upstream URLs, API keys, or credentials to this skill or chat.

Scope: three-layer setup only. Does NOT report savings or silently mutate settings. Back up `settings.json` before writing. Never expose keys, credentials, prompts, transcripts, or raw config.
