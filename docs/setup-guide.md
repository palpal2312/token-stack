# Token-saving stack setup guide

Four independent layers, use together:

| Layer | Tool | What it cuts |
|---|---|---|
| Code written | ponytail | YAGNI → reuse → stdlib → fewest lines |
| Words spoken | caveman | cuts filler, keeps technical terms |
| CLI tool output | RTK | prefix `rtk` filters long output (60–99%) |
| API context | headroom | local proxy compresses tool results/history, preserves prefix cache |

## 1. RTK (Rust Token Killer)

- Binary: `%LOCALAPPDATA%\rtk\rtk.exe`, not on PATH. Shim `~/bin/rtk` (dir already on PATH) so Git Bash can call it — see `scripts/rtk`. Remember `chmod +x`.
- Claude Code has no RTK rewrite hook → instruction-based: the agent prefixes `rtk` for long-output commands (`rtk git diff`, `rtk tsc`, `rtk go test`). Skip for short output. `rtk proxy <cmd>` bypasses the filter when you need full output for debugging.
- `rtk gain` saying "No hook installed" is normal here — hooks only exist for `rtk init -g` targeting claude; not used in this setup.

## 2. ponytail + caveman plugins

### Install + enable (both steps required)

```bash
claude plugin marketplace add JuliusBrussee/caveman
claude plugin marketplace add DietrichGebert/ponytail
claude plugin install caveman@caveman
claude plugin install ponytail@ponytail
```

**Main trap: installed ≠ enabled.** Install only populates the cache; skills don't load until `enabledPlugins` in `settings.json`:

```json
"enabledPlugins": {
  "ponytail@ponytail": true,
  "caveman@caveman": true
}
```

Format `<plugin>@<marketplace>` (marketplace = key in `known_marketplaces.json`). Skill listings refresh only in a **new session** — restart after enabling.

### Verify

```bash
grep -o '"[a-z-]*@[a-z-]*"' ~/.claude/plugins/installed_plugins.json | sort -u  # installed?
grep -A6 enabledPlugins ~/.claude/settings.json                                  # enabled?
# in session: type /ponytail-help or /caveman-help
```

Working = caveman/ponytail mode active via SessionStart hook, `/ponytail-*` `/caveman-*` slash commands, `cavecrew-*` agents available.

## 3. headroom (context compression proxy)

Ref: https://andrewpatterson.dev/posts/token-savings-rtk-headroom/

### Install + run

```bash
uv tool install --python 3.13 "headroom-ai[all]"   # 3.13 gives LiteLLM cost tracking; 3.14+ breaks
headroom proxy --port 8787 --anthropic-api-url <upstream>
```

- Binary lands at `~/.local/bin/headroom.exe`. **Upstream is baked at start** — changing upstream = restart proxy.
- Routing: `ANTHROPIC_BASE_URL=http://127.0.0.1:8787` in `settings.json` env.
- Auto-start: SessionStart hook running `scripts/headroom-ensure.sh` (checks `/readyz`, starts detached + polls ≤90s; cold start loads models ~70s). Register with matcher `startup`, timeout 120.

### Traps hit in practice

- Cold start ~70s: early `Connection refused` is normal, don't conclude the proxy died — check `/health`.
- **One-shot curl tests show zero compression**: each sessionless request is a new session → no history to compress (`transforms=none` in log). Judge via `/stats` after real multi-turn sessions.
- `kompress: unhealthy` in `/health` doesn't kill the proxy — SmartCrusher + cache still work.
- Real log: `~/.headroom/logs/proxy.log` (PERF line per request: tok_before/after/saved).
- Process-env `ANTHROPIC_BASE_URL` at launch overrides settings env → bypasses the proxy. To be sure, launch with `ANTHROPIC_BASE_URL=http://127.0.0.1:8787`.

### Verify

```bash
headroom doctor                       # proxy + routing + savings, one table
curl -s http://127.0.0.1:8787/health  # check "upstream" is correct
curl -s http://127.0.0.1:8787/stats   # tokens saved (after real sessions)
```

Revert: remove/repoint `ANTHROPIC_BASE_URL` in settings env, remove the SessionStart hook, kill the headroom process.

## 4. Secondary cases (kept brief)

- **Separate config-dir profile** (e.g. `~/.claude-something`): doesn't inherit `~/.claude` plugins/settings. Fast path: junction its `plugins` dir to the main one, then add `enabledPlugins` + hook + `ANTHROPIC_BASE_URL` in that profile's settings like the main one.
- **Profile on a custom API endpoint** (e.g. `.claude-kimicode` → `https://api.kimi.com/coding/`): looks fully configured yet bypasses the proxy — proxy healthy, savings flat. Normal case: settings env `ANTHROPIC_BASE_URL=http://127.0.0.1:8787`, nothing else. This case: repoint that value from the vendor URL to `http://127.0.0.1:8787`, keep the API key in the profile env, keep the vendor URL as the proxy's `--anthropic-api-url` upstream. Verify after restart: in-session `echo $ANTHROPIC_BASE_URL` = 127.0.0.1:8787 and `requests` rising in `~/.headroom/proxy_savings.json` (counters only there — no `last_activity` field; hit 2026-08-10).
- **Kimi Code CLI** (different agent, not Claude Code): reads skills from `~/.agents/skills/` — junction from the project's `.agents/skills/` with PowerShell `New-Item -ItemType Junction` (Git Bash `mklink /J` gets its args eaten by MSYS). RTK for Kimi: `rtk init --agent kimi` (project-scoped, writes AGENTS.md).

## New-machine checklist

The `token-stack` skill (`skills/token-stack/`, junction into `~/.claude/skills/` + `~/.agents/skills/`) packages profile-aware detection for claude-code / kimi-code / codex / agy.

1. Run detector once; default JSON output drives only missing or mismatched actions:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\detect-agent-context.ps1 -SourceRoot $PWD
   ```

2. Apply recommended actions manually, preserving unrelated profile settings and secrets. Use explicit `-ConfigDir` for secondary profiles.
3. RTK: install binary and shim `~/bin/rtk` only when detector reports it missing.
4. Install/enable plugins only when detector reports them missing or disabled.
5. Headroom: register profile-local hook and proxy base URL only when detector reports mismatch. A ready proxy with different baked upstream is stale; restart it or use a distinct port.
6. Restart session after skill/settings changes.
7. Verify with `-CheckProxy`, then `headroom doctor` or `/stats` after a real multi-turn session when route status is unknown/unavailable.
