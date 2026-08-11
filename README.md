# token-stack

4-layer token-saving stack for AI coding CLIs: **ponytail** (less code) + **caveman** (fewer words) + **RTK** (filters long CLI output) + **headroom** (proxy compresses API context).

Works with: claude-code, kimi-code, codex, agy (antigravity).

## Quick start

1. Read `skills/token-stack/SKILL.md`, then run `scripts/detect-agent-context.ps1` once for current profile state and recommended actions.
2. Full pitfalls + fallback verify commands: `docs/setup-guide.md`.

## Layout

```
skills/token-stack/SKILL.md   # the skill: detect + per-CLI setup
scripts/headroom-ensure.sh    # SessionStart hook: cold-starts headroom proxy
scripts/rtk                   # Git Bash shim for rtk.exe
docs/setup-guide.md           # full guide + pitfalls
```

## Install the skill itself

- **claude-code**: junction/copy `skills/token-stack/` into `~/.claude/skills/`, new session, `/token-stack`.
- **kimi-code**: junction/copy into `~/.agents/skills/`.
- **codex / agy**: paste SKILL.md content into the agent's instructions file.

Windows junction (PowerShell, no admin):

```powershell
New-Item -ItemType Junction -Path "$HOME\.claude\skills\token-stack" -Target '<this-repo>\skills\token-stack'
```

## Notes

- No secrets in this repo. API keys stay in your local settings — never commit them.
- `headroom-ensure.sh` reads upstream from `HEADROOM_UPSTREAM` (default: `https://api.anthropic.com`). Set it for custom Anthropic-compatible endpoints.
