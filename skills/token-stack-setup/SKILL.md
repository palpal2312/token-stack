---
name: token-stack:setup
description: Install and configure ponytail, caveman, RTK, and Headroom for a Claude profile. Use only when setup or repair is requested.
user-invocable: true
---

# Token Stack Setup

This setup installs/configures only three layers in-session: RTK, caveman, and ponytail. Do **not** install Headroom in this session; another agent must handle it. Headroom setup can crash a live session when base URL, upstream, or startup hook is wrong.

Run dry-run first:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$HOME/.claude/skills/token-stack-setup/scripts/token-stack-setup.ps1"
```

Apply only after explicit confirmation:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$HOME/.claude/skills/token-stack-setup/scripts/token-stack-setup.ps1" -Apply
```

Pass `-ProfileDirectory` for another profile. Script installs/enables caveman and ponytail, checks RTK, and never installs, starts, stops, or configures Headroom.

If Headroom is intentionally configured later, edit `.env` or profile settings **by hand**, after backing up and closing Claude Code:

```dotenv
ANTHROPIC_BASE_URL=http://127.0.0.1:8787
```

Then have the dedicated Headroom agent configure the proxy upstream and startup hook. Do not add upstream URLs, API keys, or credentials to this skill or chat.

**Multi-instance warning**: When running multiple Claude profiles, each needs its own Headroom port AND its own `--memory-db-path`. Without separate DB paths, the second `headroom.exe` instance crashes silently due to SQLite lock conflicts. Set `HEADROOM_DB_PATH` in `.env.<profile>` to `~/.<profile>/headroom-data/headroom.db`. See `docs/setup-guide.md` § 4 for the full procedure.

**Operational Guidelines**:
1. **Sub2API Port Migration**: Sub2API runs on native port **9284** (not 5173). Ensure `HEADROOM_UPSTREAM` points to `http://127.0.0.1:9284`.
2. **Model Naming Rules**:
   - For Kimi Coding API, use official model `kimi-k3` (never append `[1m]`).
   - For Sub2API / Antigravity, ensure model aliases (`claude-opus-4-5` -> `claude-opus-4-6-thinking`) are mapped in gateway constants to prevent `400 Invalid request`.
3. **Pre-flight Wrapper Pattern**: In launcher scripts (`claude-<profile>.ps1`), probe `/readyz` before calling `claude` CLI to eliminate startup race conditions.
4. **Mandatory 3-Stage Verification**: Always verify `/readyz`, direct upstream streaming, and proxy streaming before declaring setup or repairs complete.

Scope: three-layer setup only. Does NOT report savings or silently mutate settings. Back up `settings.json` before writing. Never expose keys, credentials, prompts, transcripts, or raw config.

