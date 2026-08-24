# Token-saving stack setup guide

Four independent layers, use together:

| Layer | Tool | What it cuts |
|---|---|---|
| Code written | ponytail | YAGNI â†’ reuse â†’ stdlib â†’ fewest lines |
| Words spoken | caveman | cuts filler, keeps technical terms |
| CLI tool output | RTK | prefix `rtk` filters long output (60â€“99%) |
| API context | headroom | local proxy compresses tool results/history, preserves prefix cache |

## 1. RTK (Rust Token Killer)

- Binary: `%LOCALAPPDATA%\rtk\rtk.exe`, not on PATH. Shim `~/bin/rtk` (dir already on PATH) so Git Bash can call it â€” see `scripts/rtk`. Remember `chmod +x`.
- Claude Code has no RTK rewrite hook â†’ instruction-based: the agent prefixes `rtk` for long-output commands (`rtk git diff`, `rtk tsc`, `rtk go test`). Skip for short output. `rtk proxy <cmd>` bypasses the filter when you need full output for debugging.
- `rtk gain` saying "No hook installed" is normal here â€” hooks only exist for `rtk init -g` targeting claude; not used in this setup.

## 2. ponytail + caveman plugins

### Install + enable (both steps required)

```bash
claude plugin marketplace add JuliusBrussee/caveman
claude plugin marketplace add DietrichGebert/ponytail
claude plugin install caveman@caveman
claude plugin install ponytail@ponytail
```

**Main trap: installed â‰  enabled.** Install only populates the cache; skills don't load until `enabledPlugins` in `settings.json`:

```json
"enabledPlugins": {
  "ponytail@ponytail": true,
  "caveman@caveman": true
}
```

Format `<plugin>@<marketplace>` (marketplace = key in `known_marketplaces.json`). Skill listings refresh only in a **new session** â€” restart after enabling.

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

- Binary lands at `~/.local/bin/headroom.exe`. **Upstream is baked at start** â€” changing upstream = restart proxy.
- Routing: `ANTHROPIC_BASE_URL=http://127.0.0.1:8787` in `settings.json` env.
- Auto-start: SessionStart hook running `scripts/headroom-ensure.sh` (checks `/readyz`, starts detached + polls â‰¤90s; cold start loads models ~70s). Register with matcher `startup`, timeout 120.

### Traps hit in practice

- Cold start ~70s: early `Connection refused` is normal, don't conclude the proxy died â€” check `/health`.
- **One-shot curl tests show zero compression**: each sessionless request is a new session â†’ no history to compress (`transforms=none` in log). Judge via `/stats` after real multi-turn sessions.
- `kompress: unhealthy` in `/health` doesn't kill the proxy â€” SmartCrusher + cache still work.
- Real log: `~/.headroom/logs/proxy.log` (PERF line per request: tok_before/after/saved).
- Process-env `ANTHROPIC_BASE_URL` at launch overrides settings env â†’ bypasses the proxy. To be sure, launch with `ANTHROPIC_BASE_URL=http://127.0.0.1:8787`.
- **Windows `EFTYPE` error**: If your CLI throws `SessionStart:startup hook error - Failed to run: EFTYPE: inappropriate file type or format, uv_spawn`, it means Node.js is trying to execute the `.sh` file directly. Fix it by changing the hook command in `settings.json` to `"C:/Program Files/Git/bin/bash.exe"` with the script path as an argument.

### Verify

```bash
headroom doctor                       # proxy + routing + savings, one table
curl -s http://127.0.0.1:8787/health  # check "upstream" is correct
curl -s http://127.0.0.1:8787/stats   # tokens saved (after real sessions)
```

Revert: remove/repoint `ANTHROPIC_BASE_URL` in settings env, remove the SessionStart hook, kill the headroom process.

## 4. Multi-profile headroom isolation (CRITICAL)

Each profile **MUST** use its own headroom port **AND** its own `--memory-db-path`. Port collisions cause one profile to route through another profile's upstream â€” silent data leak / auth failure. Shared DB paths cause the second instance to crash silently due to SQLite lock conflicts.

### Port + DB assignment convention

| Profile | Headroom port | `--memory-db-path` | Upstream |
|---|---|---|---|
| `.claude` (default) | 8787 | (default) | `https://api.anthropic.com` |
| `.claude-sub2api-02` | 8787 | `~/.claude-sub2api-02/headroom-data/headroom.db` | `http://127.0.0.1:5173` (sub2api) |
| `.claude-kimicode` | 8788 | `~/.claude-kimicode/headroom-data/headroom.db` | `https://api.kimi.com/coding` |
| `.claude-<next>` | 8789+ | `~/.<profile>/headroom-data/headroom.db` | read from original `ANTHROPIC_BASE_URL` |

> **Rule**: if only ONE profile uses Headroom, skip `--memory-db-path` (single-instance uses the default location). The moment you add a second profile, BOTH need explicit `--memory-db-path`.

### When installing token-stack on a new profile

1. **Read upstream FIRST**: Before touching `settings.json`, read the existing `ANTHROPIC_BASE_URL` from the profile's `env` section (or `.env.<profile>` file). This is the profile's real upstream and becomes `HEADROOM_UPSTREAM`.
2. **Pick a free port**: Scan existing `.env.claude-*` files or running `headroom` processes for port values. Dynamically scan ports from 8787 to 9999, verify TCP socket availability, and assign the first free port.
3. **Create profile-local DB directory**: `mkdir -p ~/.<profile>/headroom-data/`
4. **Write `.env.<profile>`**: Set `HEADROOM_UPSTREAM=<original-url>`, `HEADROOM_PORT=<free-port>`, `HEADROOM_DB_PATH=~/.<profile>/headroom-data/headroom.db`, `ANTHROPIC_BASE_URL=<original-url>` (fallback if headroom is down).
5. **Update `settings.json`**: Set `ANTHROPIC_BASE_URL` to `http://127.0.0.1:<free-port>` in the env section.
6. **Copy `headroom-ensure.sh`** into the profile's `hooks/` directory. The script reads `HEADROOM_PORT`, `HEADROOM_UPSTREAM`, and `HEADROOM_DB_PATH` from the environment.
7. **Register SessionStart hook** with `"C:/Program Files/Git/bin/bash.exe"` to avoid Windows EFTYPE error.

### Common traps

- **Forgot `--memory-db-path` on the second instance**: Headroom uses a SQLite database (under `~/.headroom/`) that locks exclusively. The second `headroom.exe` process starts, prints the banner, then crashes within seconds. Symptom: `/readyz` returns `200` briefly, then `Connection refused`. Fix: add `--memory-db-path` pointing to a per-profile directory.
- **Forgot to read upstream before overwriting**: Profile silently routes to the wrong API. Always read `ANTHROPIC_BASE_URL` from settings BEFORE modifying it.
- **Shared port 8787**: Two profiles can't share a headroom port â€” the first one to start "wins" and sets the upstream for all callers on that port.
- **`.env` overrides settings.json**: The wrapper script loads `.env.<profile>` into process env before Claude runs. If `.env` contains `ANTHROPIC_API_KEY`, it overrides `settings.json` env â€” causing auth mismatch. Keep API keys in `settings.json` only; `.env` is for headroom routing vars.
- **Cold start ~70s vs crash**: Both look like `Connection refused`. Difference: a cold-starting process stays alive (check `Get-Process headroom`); a crashed one disappears. Always verify the process exists before waiting.
## 5. Other secondary cases (kept brief)

- **Separate config-dir profile** (e.g. `~/.claude-something`): doesn't inherit `~/.claude` plugins/settings. Fast path: junction its `plugins` dir to the main one, then add `enabledPlugins` + hook + `ANTHROPIC_BASE_URL` in that profile's settings like the main one.
- **Profile on a custom API endpoint** (e.g. `.claude-kimicode` â†’ `https://api.kimi.com/coding/`): looks fully configured yet bypasses the proxy â€” proxy healthy, savings flat. Normal case: settings env `ANTHROPIC_BASE_URL=http://127.0.0.1:8787`, nothing else. This case: repoint that value from the vendor URL to `http://127.0.0.1:<profile-port>`, keep the API key in the profile env, keep the vendor URL as the proxy's `--anthropic-api-url` upstream. Verify after restart: in-session `echo $ANTHROPIC_BASE_URL` = 127.0.0.1:<port> and `requests` rising in `~/.headroom/proxy_savings.json` (counters only there â€” no `last_activity` field; hit 2026-08-10).
- **Kimi Code CLI** (different agent, not Claude Code): reads skills from `~/.agents/skills/` â€” junction from the project's `.agents/skills/` with PowerShell `New-Item -ItemType Junction` (Git Bash `mklink /J` gets its args eaten by MSYS). RTK for Kimi: `rtk init --agent kimi` (project-scoped, writes AGENTS.md).

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

