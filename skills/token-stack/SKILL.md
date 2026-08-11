---
name: token-stack
description: Set up or verify the 4-layer token-saving stack (ponytail + caveman + RTK + headroom) on claude-code, kimi-code, codex, or agy (antigravity) CLI. Use when asked to "setup token saving", install rtk/headroom/ponytail/caveman, replicate this machine's agent setup, or check whether a machine/profile already has it.
---

# token-stack

Four independent layers: ponytail (less code), caveman (fewer words), RTK (filters long CLI output), headroom (proxy compresses API context).

Full pitfalls: `docs/setup-guide.md` in this repo.

## Detect current session profile first

Run one read-only detector. Default output is compact JSON for agent parsing; `-Human` is optional:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File "$PWD/scripts/detect-agent-context.ps1" `
  -SourceRoot "$PWD"
```

For another profile, pass `-ConfigDir`. Precedence: explicit parameter, `CLAUDE_CONFIG_DIR`, then `$HOME/.claude`. Detector never writes files, installs plugins, starts processes, or prints secret values. Exit `0` means valid result, even when actions are recommended; nonzero means invocation or fatal runtime failure.

Use returned `actions` as decision input. Do not reread `settings.json`, rerun grep, or call curl when JSON already answers it. Apply only needed actions, then run detector again. Read full settings only before an approved repair; preserve unrelated hooks, env values, plugins, models, and API keys.

Action order:

1. `inspect-invalid-settings`, `inspect-missing-settings`, `locate-source-root`
2. `remove-process-route-override` or `set-proxy-base-url`
3. `update-profile-skill`, `create-profile-hook`, `register-profile-hook`
4. `enable-*`, `install-*`
5. `inspect-stale-upstream`, `start-or-check-headroom`
6. `restart-session-after-repair`

Important fields: `profile.effectivePath`, `settings.baseUrl.requested/effective/source`, `skill.drift`, `hook.sessionStart`, `proxy.routeStatus`, `actions`. `-CheckProxy` adds bounded `/health` and compact `/stats` checks; omit it for fast local-only detection:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File "$PWD/scripts/detect-agent-context.ps1" `
  -ConfigDir "$HOME/.claude-sub2api" `
  -SourceRoot "$PWD" `
  -CheckProxy
```

`process_override` means launcher environment wins over profile settings. `stale_upstream` means ready headroom process has different baked upstream; `/readyz` alone is not proof route is correct. Upstream changes require proxy restart or a distinct port. Other profile hooks are diagnostics only; never rewrite them mechanically.

## Confirm routing after real session

Use only after repair/restart or when detector reports `unknown`/`unavailable`:

```bash
headroom doctor
curl -s -m 3 http://127.0.0.1:8787/health
curl -s -m 3 http://127.0.0.1:8787/stats
```

Success requires `/health` ready with healthy upstream, then rising request count under `agent_usage.totals.requests` (schema may vary) and your client in `agent_usage` after a real multi-turn session. One-shot curl does not prove compression. If health passes but request count stays flat, agent bypasses proxy; inspect effective process `ANTHROPIC_BASE_URL` and restart.

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

**Custom-endpoint profile (Kimi etc.)** — normal case is one line (`ANTHROPIC_BASE_URL=http://127.0.0.1:8787` in settings env, done). Special case: a profile already pointing at a vendor endpoint (e.g. `.claude-kimicode` → `https://api.kimi.com/coding/`) *looks* configured but bypasses the proxy. Fix: repoint that profile's `ANTHROPIC_BASE_URL` to `http://127.0.0.1:8787`; API key stays in the profile env, vendor URL stays baked as the proxy's `--anthropic-api-url` upstream. Verify post-restart: in-session `echo $ANTHROPIC_BASE_URL` shows 127.0.0.1:8787, and `requests` in `~/.headroom/proxy_savings.json` rises per turn (file has counters only, no `last_activity` timestamp).

## RTK (shared)

Binary at `%LOCALAPPDATA%\rtk\rtk.exe`; Git Bash needs shim `~/bin/rtk` (see `scripts/rtk`):

```sh
#!/bin/sh
exec "$LOCALAPPDATA/rtk/rtk.exe" "$@"
```

Use: prefix long-output commands (`rtk git diff`, `rtk tsc`). `rtk proxy <cmd>` bypasses the filter.
