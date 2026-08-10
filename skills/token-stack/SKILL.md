---
name: token-stack
description: Set up or verify the 4-layer token-saving stack (ponytail + caveman + RTK + headroom) on claude-code, kimi-code, codex, or agy (antigravity) CLI. Use when asked to "setup token saving", install rtk/headroom/ponytail/caveman, replicate this machine's agent setup, or check whether a machine/profile already has it.
---

# token-stack

Four independent layers: ponytail (less code), caveman (fewer words), RTK (filters long CLI output), headroom (proxy compresses API context).

Full pitfalls: `docs/setup-guide.md` in this repo.

## Detect current machine first

```bash
which rtk && rtk --version                      # RTK shim works?
grep -o '"[a-z-]*@[a-z-]*"' ~/.claude/plugins/installed_plugins.json | sort -u
grep -A6 enabledPlugins ~/.claude/settings.json # ponytail + caveman = true?
curl -s -m 3 http://127.0.0.1:8787/health       # headroom up? check "upstream"
ls ~/.agents/skills | grep -E 'ponytail|caveman' # kimi-code skills junctioned?
```

## claude-code

```bash
claude plugin marketplace add JuliusBrussee/caveman
claude plugin marketplace add DietrichGebert/ponytail
claude plugin install caveman@caveman ponytail@ponytail
```

Then in `settings.json` (per config dir — installed ≠ enabled):

```json
"enabledPlugins": { "ponytail@ponytail": true, "caveman@caveman": true },
"env": { "ANTHROPIC_BASE_URL": "http://127.0.0.1:8787" }
```

SessionStart hook `scripts/headroom-ensure.sh` (matcher `startup`, timeout 120) cold-starts the proxy. Restart session after enabling. Extra config-dir profile: junction its `plugins` dir to the main one, repeat the settings edits.

## kimi-code

Skills load from `~/.agents/skills/` only — junction from the project, PowerShell (Git Bash mklink eats args):

```powershell
New-Item -ItemType Junction -Path "$HOME\.agents\skills\<name>" -Target '<project>\.agents\skills\<name>'
```

RTK: `rtk init --agent kimi` in project (writes AGENTS.md; instruction-based, no hooks). New session to see skills.

## codex

```bash
headroom wrap codex   # or: OPENAI_BASE_URL=http://127.0.0.1:8787/v1 codex
```

Skills: copy SKILL.md dirs into codex's instructions/skills path, or paste the ponytail/caveman rules into AGENTS.md — instruction-based, no plugin system.

## agy (antigravity)

```bash
rtk init --agent antigravity
```

Headroom: point its Anthropic-compatible base URL at `http://127.0.0.1:8787`. ponytail/caveman rules go into its rules/instructions file manually.

## headroom (shared, all CLIs)

```bash
uv tool install --python 3.13 "headroom-ai[all]"
headroom proxy --port 8787 --anthropic-api-url <upstream>   # upstream baked at start
headroom doctor
```

Caveats: cold start ~70s (Connection refused ≠ dead); one-shot curl shows 0 compression by design — judge via `/stats` after real sessions; process-env `ANTHROPIC_BASE_URL` overrides settings env and bypasses the proxy.

## RTK (shared)

Binary at `%LOCALAPPDATA%\rtk\rtk.exe`; Git Bash needs shim `~/bin/rtk` (see `scripts/rtk`):

```sh
#!/bin/sh
exec "$LOCALAPPDATA/rtk/rtk.exe" "$@"
```

Use: prefix long-output commands (`rtk git diff`, `rtk tsc`). `rtk proxy <cmd>` bypasses the filter.
