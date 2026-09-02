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

#### Port + DB assignment convention

| Profile | Headroom port | `--memory-db-path` | Upstream | Notes |
|---|---|---|---|---|
| `.claude` (default) | 8787 | (default) | `https://api.anthropic.com` | Official Anthropic API |
| `.claude-kimicode` | 8788 | `~/.claude-kimicode/headroom-data/headroom.db` | `https://api.kimi.com/coding` | Kimi Coding API (model: `kimi-k3`) |
| `.claude-sub2api` (Profile 01) | 8790 | `~/.claude-sub2api/headroom-data/headroom.db` | `http://127.0.0.1:9284` | Sub2API Gateway |
| `.claude-sub2api-02` (Profile 02) | 8807 | `~/.claude-sub2api-02/headroom-data/headroom.db` | `http://127.0.0.1:9284` | Sub2API Gateway (isolated DB & Port) |
| `.claude-<next>` | 8808+ | `~/.<profile>/headroom-data/headroom.db` | read from original `ANTHROPIC_BASE_URL` | Dynamically allocated |

> **Rule**: if only ONE profile uses Headroom, skip `--memory-db-path` (single-instance uses the default location). The moment you add a second profile, BOTH need explicit `--memory-db-path`.
> **Directory pre-requisite**: The parent directory for `--memory-db-path` must exist before launching (`mkdir -p ~/.<profile>/headroom-data/`). If the directory is missing, SQLite cannot create the database and `headroom.exe` will terminate immediately.

### When installing token-stack on a new profile

1. **Read upstream FIRST**: Before touching `settings.json`, read the existing `ANTHROPIC_BASE_URL` from the profile's `env` section (or `.env.<profile>` file). This is the profile's real upstream and becomes `HEADROOM_UPSTREAM`. (Note: Sub2API native port is **9284**, not 5173).
2. **Pick a free port**: Scan existing `.env.claude-*` files or running `headroom` processes for port values. Dynamically scan ports from 8787 to 9999, verify TCP socket availability, and assign the first free port.
3. **Create profile-local DB directory**: `mkdir -p ~/.<profile>/headroom-data/`
4. **Write `.env.<profile>`**: Set `HEADROOM_UPSTREAM=<original-url>`, `HEADROOM_PORT=<free-port>`, `HEADROOM_DB_PATH=~/.<profile>/headroom-data/headroom.db`, `ANTHROPIC_BASE_URL=http://127.0.0.1:<free-port>`.
5. **Update `settings.json`**: Set `ANTHROPIC_BASE_URL` to `http://127.0.0.1:<free-port>` in the env section.
6. **Pre-flight Wrapper Hook Pattern**:
   Do NOT rely exclusively on Claude Code's `SessionStart` hook to start Headroom. In batch execution (`claude -p "..."`), subagent calls, or on Windows when bash subshells exit, child processes may be reaped prematurely.
   Instead, in your PowerShell launcher (`claude-<profile>.ps1`), embed a pre-flight probe:
   ```powershell
   $readyzUrl = "http://127.0.0.1:<PORT>/readyz"
   $ready = $false
   try {
       $r = Invoke-WebRequest -Uri $readyzUrl -UseBasicParsing -TimeoutSec 1 -ErrorAction SilentlyContinue
       if ($r -and $r.StatusCode -eq 200) { $ready = $true }
   } catch {}
   if (-not $ready) {
       Start-Process -WindowStyle Hidden -FilePath "$HOME\.local\bin\headroom.exe" -ArgumentList 'proxy','--port','<PORT>','--anthropic-api-url','<UPSTREAM>','--memory-db-path','<DB_PATH>'
       for ($i = 0; $i -lt 30; $i++) {
           Start-Sleep -Milliseconds 500
           try {
               $r = Invoke-WebRequest -Uri $readyzUrl -UseBasicParsing -TimeoutSec 1 -ErrorAction SilentlyContinue
               if ($r -and $r.StatusCode -eq 200) { break }
           } catch {}
       }
   }
   ```

### Common traps

- **Sub2API Port 5173 vs 9284**: Sub2API previously used dev port 5173 but now runs on standard port **9284**. Hardcoded 5173 configurations cause persistent `ConnectionRefused` errors.
- **Forgot `--memory-db-path` on the second instance**: Headroom uses a SQLite database that locks exclusively. The second `headroom.exe` process starts, prints the banner, then crashes within seconds. Symptom: `/readyz` returns `200` briefly, then `Connection refused`. Fix: add `--memory-db-path` pointing to a per-profile directory.
- **Forgot to read upstream before overwriting**: Profile silently routes to the wrong API. Always read `ANTHROPIC_BASE_URL` from settings BEFORE modifying it.
- **Shared port**: Two profiles cannot share a headroom port — the first one to start "wins" and sets the upstream for all callers on that port.
- **`.env` overrides settings.json**: The wrapper script loads `.env.<profile>` into process env before Claude runs. If `.env` contains `ANTHROPIC_API_KEY`, it overrides `settings.json` env — causing auth mismatch. Keep API keys in `settings.json` only; `.env` is for headroom routing vars.
- **Cold start ~70s vs crash**: Both look like `Connection refused`. Difference: a cold-starting process stays alive (check `Get-Process headroom`); a crashed one disappears. Always verify the process exists before waiting.

## 5. Provider-Specific Model & Quota Traps

### A. Google Antigravity (Gemini Tiered / Sub2API)
- **Whitelisted Models**:
  - `claude-sonnet-4-5`
  - `claude-sonnet-4-5-thinking`
  - `claude-opus-4-6-thinking`
- **CLI Model Switch Alias Trap**:
  When users run `/model` inside Claude Code and choose "Opus 4.5", the CLI requests `claude-opus-4-5` or `claude-3-opus-20240229`. If Sub2API does not map these aliases, it throws `400 Invalid request`. Ensure `DefaultAntigravityModelMapping` maps `claude-opus-4-5` -> `claude-opus-4-6-thinking`.
- **TPM Limit & 503 Cascades**:
  Heavy token payloads (e.g. bloated hooks injecting ~70k tokens) trigger Google Antigravity 429 rate limits. Sub2API records cooldowns in `accounts.extra["model_rate_limits"]`. If a group has only 1 account, this triggers `503 No available accounts`. Enable token compression plugins (`caveman`, `ponytail`) to keep requests lean.

### B. Kimi Coding API (`https://api.kimi.com/coding`)
- **Model Name Suffix Trap**:
  Kimi Coding API strictly rejects model names containing artificial context window suffixes such as `kimi-k3[1m]`, returning `401 Unauthorized` or `Invalid model`.
  - ❌ Incorrect: `kimi-k3[1m]`
  - ✅ Correct: `kimi-k3` or `kimi-latest`
- **Authentication**:
  Pass the token via standard header `x-api-key: sk-kimi-...` or `Authorization: Bearer sk-kimi-...`.

### C. Alibaba Cloud Model Studio (MaaS Token Plan)
- **Weekly Allocation Quota Trap**:
  Alibaba Cloud token plans enforce strict weekly quotas. When exceeded, the upstream returns HTTP 429:
  ```json
  {"code":"Throttling.AllocationQuota","message":"Your token-plan 1-week quota has been exhausted. The quota will reset at MM-DD HH:MM:SS UTC."}
  ```
  This is an upstream account credit boundary, not a proxy or networking failure.

## 6. Mandatory End-to-End Verification Protocol

Before reporting any setup, repair, or migration as "Done", run the 3-stage validation pipeline:

1. **Stage 1 - Proxy Readiness**:
   ```bash
   curl -s -m 2 http://127.0.0.1:<PORT>/readyz
   # Must return HTTP 200 {"status":"healthy","ready":true}
   ```
2. **Stage 2 - Direct Upstream Authentication & Streaming**:
   Send a minimal streaming request (`stream: true`, `max_tokens: 10`) directly to the upstream URL with the target model and API key to confirm validity and quota availability before blaming the proxy.
3. **Stage 3 - End-to-End Proxy Stream Verification**:
   Send the streaming request through `http://127.0.0.1:<PORT>/v1/messages`.
   Verify that:
   - Status code is `200 OK`.
   - Streaming events (`event: message_start`, `data: {"type": ...}`) flow properly.
   - Headroom `/stats` logs the processed request.

## 7. The 7-Layer Master Token & Context Architecture

The complete engine spans across all 4 key lifecycle phases:

| Layer | Component | Function | Setup Command |
|---|---|---|---|
| **Layer 0** | **Graphify / GitNexus / CodeGraph** | AST Code Topology | `.\scripts\install-code-graph.ps1 -Engine graphify -Apply` |
| **Layer 1** | **Ponytail** | Code Reduction | `.\scripts\install-token-stack.ps1 -Apply` |
| **Layer 2** | **Caveman** | Word Reduction | `.\scripts\install-token-stack.ps1 -Apply` |
| **Layer 3** | **RTK** | CLI Output Filter | Configured via shim |
| **Layer 4** | **Headroom** | Network Context Proxy | `.\scripts\install-token-stack.ps1 -Apply` |
| **Layer 5** | **MemoraX Code** | Knowledge Harvester | `.\scripts\install-memory-layer.ps1 -Provider memorax -Apply` |
| **Layer 6** | **OpenViking / Obsidian** | Context Database Platform | `.\scripts\install-context-platform.ps1 -Platform openviking -Apply` |

For detailed architectural specifications, read [`docs/architecture.md`](architecture.md).

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
