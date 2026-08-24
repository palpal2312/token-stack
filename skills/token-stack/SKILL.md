---
name: token-stack
description: Route token-stack work across read-only health checks, three-layer setup, and measured savings reports for Claude Code, Kimi Code, Codex, or Antigravity. Use when checking, setting up, or measuring ponytail, caveman, RTK, or Headroom.
user-invocable: true
---

# Token Stack Router

Four independent layers:

- ponytail: less code through reuse, stdlib, and YAGNI.
- caveman: fewer words without dropping technical meaning.
- RTK: filters long CLI output.
- Headroom: local proxy compresses API context.

Route by intent:

- **Health**: use `token-stack:health` for directory, profile, harness, model, and four-layer status. Read-only.
- **Setup**: use `token-stack:setup` for RTK/caveman/ponytail setup. Dry-run first; explicit confirmation before apply. Headroom stays out of this session and needs a dedicated agent.
- **Report**: use `token-stack:report` for observed counters. Keep RTK, Headroom, Claude usage, and Ponytail/Caveman evidence separate.

## Detect current profile

Run bundled detector once. Default output is compact JSON; `-Human` is optional:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File "$PWD/scripts/detect-agent-context.ps1" `
  -SourceRoot "$PWD"
```

For another profile, pass `-ConfigDir`. Precedence: explicit parameter, `CLAUDE_CONFIG_DIR`, then `$HOME/.claude`. Detector is read-only and must not print secrets. Exit `0` means valid result, even when actions are recommended.

Use returned `actions` as decision input. Preserve unrelated settings, hooks, env values, plugins, models, and API keys.

Important fields: `profile.effectivePath`, `settings.baseUrl.requested/effective/source`, `skill.drift`, `hook.sessionStart`, `proxy.routeStatus`, `actions`. `-CheckProxy` adds bounded `/health` and `/stats` checks.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File "$PWD/scripts/detect-agent-context.ps1" `
  -ConfigDir "$HOME/.claude-sub2api" `
  -SourceRoot "$PWD" `
  -CheckProxy
```

`process_override` means launcher environment wins over profile settings. `stale_upstream` means a ready Headroom process has a different baked upstream; restart or use a distinct port. Never rewrite hooks mechanically.

## Claude Code plugins

Installed does not mean enabled. Both steps are required:

```bash
claude plugin marketplace add JuliusBrussee/caveman
claude plugin marketplace add DietrichGebert/ponytail
claude plugin install caveman@caveman ponytail@ponytail
```

```json
"enabledPlugins": {
  "ponytail@ponytail": true,
  "caveman@caveman": true
}
```

Restart session after enabling. Extra config profiles need their own plugin/settings state.

## Real counters

Different layers have different truth boundaries:

- RTK: local command-output estimate from `history.db`; not provider billing.
- Headroom: proxy compression counters after real multi-turn sessions; one-shot requests prove nothing.
- Claude usage: sanitized input/output/cache usage records in `token-stack-usage.jsonl`.
- Ponytail/Caveman: observed usage only; claim savings only after matched on/off A/B runs.

Use bundled scripts:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File "$HOME/.claude/skills/token-stack-health/scripts/token-stack-health.ps1"

powershell -NoProfile -ExecutionPolicy Bypass `
  -File "$HOME/.claude/skills/token-stack-setup/scripts/token-stack-setup.ps1"

powershell -NoProfile -ExecutionPolicy Bypass `
  -File "$HOME/.claude/skills/token-stack-report/scripts/token-stack-report.ps1"
```

Never add layer counters into one provider-savings number. Missing counters are `UNKNOWN`, not zero. Never output keys, credentials, upstream URLs, prompts, transcripts, or raw config.

## Shared RTK

Binary: `%LOCALAPPDATA%\rtk\rtk.exe`. Git Bash shim: `scripts/rtk`.

```powershell
rtk git diff
rtk tsc
```

Use `rtk proxy <cmd>` only when full unfiltered output is required for debugging.

## Headroom boundary

Headroom setup is intentionally separate. Do not install, start, stop, or re-route Headroom from the three-layer setup skill. If a dedicated Headroom agent configures it, verify `/health` and `/stats` after a real multi-turn session. On Windows, run `.sh` SessionStart hooks through Git Bash (`C:/Program Files/Git/bin/bash.exe`) to avoid `EFTYPE`.

### Multi-profile port isolation (CRITICAL)

Each profile **MUST** use its own headroom port. Two profiles sharing port 8787 will route through whichever upstream started first â€” causing silent auth failures or data leaks.

When installing token-stack on a new profile:

1. **Read upstream FIRST** from the profile's existing `ANTHROPIC_BASE_URL` in `settings.json` env section â€” this is the real API endpoint (e.g. `https://agentrouter.org`, `http://127.0.0.1:5173`).
2. **Pick a free port** by scanning `~/.env.claude-*` files for `HEADROOM_PORT=` values. Use next unused port starting from 8787.
3. **Write `.env.<profile>`** with `HEADROOM_UPSTREAM=<original-url>`, `HEADROOM_PORT=<free-port>`. Do NOT put API keys in `.env` â€” keep them in `settings.json` only.
4. **Update `settings.json`** env `ANTHROPIC_BASE_URL` â†’ `http://127.0.0.1:<free-port>`.
5. **Copy `headroom-ensure.sh`** to profile's `hooks/` dir with default port patched to `<free-port>`.

The install script (`scripts/install-token-stack.ps1 -Apply`) automates all of the above.

Full pitfalls: `docs/setup-guide.md`.

