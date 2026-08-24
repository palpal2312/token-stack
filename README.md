# token-stack

4-layer token-saving stack for AI coding CLIs: **ponytail** (less code) + **caveman** (fewer words) + **RTK** (filters long CLI output) + **headroom** (proxy compresses API context).

Works with: **claude-code**, **codex**, **kimi-code**, and **agy** (antigravity).

## Quick start

1. Read `skills/token-stack/SKILL.md`, then run `scripts/detect-agent-context.ps1` once for current profile state and recommended actions.
2. Comprehensive guides and troubleshooting:
   - Claude Code Setup: `docs/setup-guide.md`
   - **Codex Setup & Lessons Learned**: [`docs/codex-setup-guide.md`](docs/codex-setup-guide.md)

## Layout

```text
skills/token-stack/SKILL.md          # router: health, setup, report
skills/token-stack-health/            # read-only status checker
skills/token-stack-setup/             # three-layer setup; Headroom excluded
skills/token-stack-report/            # observed savings counters
scripts/install-token-stack.ps1       # dynamic installer (ports 8787..9999)
scripts/headroom-ensure.ps1           # PowerShell SessionStart hook for Headroom
scripts/headroom-ensure.sh            # Shell SessionStart hook for Headroom
scripts/rtk                           # Git Bash shim for rtk.exe
docs/setup-guide.md                   # Claude setup guide + multi-profile rules
docs/codex-setup-guide.md             # Codex setup guide + 7 key lessons learned
```

## 4-Layer Architecture

| Layer | Tool | Purpose | Configuration |
|---|---|---|---|
| **Layer 1: Code** | **Ponytail** | Enforces KISS, YAGNI, standard libraries, no bloat | `~/<profile>/skills/ponytail*` |
| **Layer 2: Words** | **Caveman** | Eliminates filler words, keeps technical precision | `~/<profile>/skills/caveman*` |
| **Layer 3: CLI Output** | **RTK** | Truncates/summarizes verbose command line outputs | `rtk init -g` / `@RTK.md` |
| **Layer 4: Context Proxy** | **Headroom** | Lossless prompt caching and context compression | `headroom proxy --port <free-port>` |

## Install the skill family

From this repository, run installer in dry-run mode first. It dynamically allocates free ports from `8787` to `9999`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\install-token-stack.ps1
```

Review output, then apply explicitly to a chosen profile:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\install-token-stack.ps1 `
  -ProfileDirectory "$HOME\.claude" `
  -Apply
```

## Agent Installation

- **claude-code**: junction/copy `skills/token-stack/` into `~/.claude/skills/`.
- **codex**: junction/copy into `~/.codex/skills/`. See [`docs/codex-setup-guide.md`](docs/codex-setup-guide.md).
- **kimi-code**: junction/copy into `~/.agents/skills/`.

Windows junction (PowerShell, no admin):

```powershell
New-Item -ItemType Junction -Path "$HOME\.codex\skills\token-stack" -Target '<this-repo>\skills\token-stack'
```

## Multi-Profile & Dynamic Port Allocation (8787–9999)

When running multiple agent profiles (e.g. `.claude`, `.claude-sub2api`, `.codex`), each profile needs:

- **Dynamic free port** (`HEADROOM_PORT`): scanned automatically across `8787`..`9999`.
- **Dedicated DB path** (`HEADROOM_DB_PATH`): `--memory-db-path "$HOME/.<profile>/headroom-data/headroom.db"` (prevents SQLite lock crashes on concurrent runs).

## Critical Invariants

1. **UTF-8 No BOM**: All config files and `SKILL.md` files must be saved in UTF-8 without BOM to avoid Rust parser errors in Codex.
2. **Cold Start**: Headroom pre-loads compressors on start (60–90s). The startup hook polls `/readyz` up to 90s.
3. **No secrets in repository**: Keep API keys in local `settings.json` or `.env` only.