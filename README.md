# token-stack

Token-saving stack for AI coding CLIs with **4 Core Token Reduction Layers** + **1 Optional Pluggable Long-Term Memory Layer**:

- **Core Layer 1: Code** -> **ponytail** (less boilerplate, stdlib, YAGNI)
- **Core Layer 2: Words** -> **caveman** (fewer conversational filler words)
- **Core Layer 3: CLI Output** -> **RTK** (filters verbose command outputs)
- **Core Layer 4: Context Proxy** -> **headroom** (lossless context compression & prompt cache)
- **Optional Layer 5: Long-Term Memory** -> **MemoraX Code / Mem0 / Local Knowledge** (cross-session memory)

Works with: **claude-code**, **codex**, **kimi-code**, and **agy** (antigravity).

## Architecture

```text
+-----------------------------------------------------------------------------------------+
|                               4 + 1 LAYER TOKEN STACK                                   |
+-----------------------------------------------------------------------------------------+
| [Core Layer 1] Code Reduction     -> Ponytail (KISS, YAGNI, No fluff code)             |
| [Core Layer 2] Word Reduction     -> Caveman (Concise technical responses)             |
| [Core Layer 3] CLI Output Filter  -> RTK - Rust Token Killer (Filters log outputs)      |
| [Core Layer 4] Context Proxy      -> Headroom Proxy (Lossless context compress & cache) |
+ - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - +
| [Optional Layer 5] Memory Layer   -> PLUGGABLE PROVIDERS (Choose 1 or None):            |
|     1. MemoraX Code               -> https://github.com/memorax-ai/memorax-code         |
|     2. Mem0 (MCP)                 -> https://github.com/mem0ai/mem0                     |
|     3. Local MCP Knowledge Memory -> 100% Offline SQLite / Markdown                     |
|     4. None (Default)             -> Keep 4 core token reduction layers only            |
+-----------------------------------------------------------------------------------------+
```

## Quick Start

1. Read `skills/token-stack/SKILL.md`, then run `scripts/detect-agent-context.ps1` for profile detection.
2. Full guides:
   - Claude Code Setup: [`docs/setup-guide.md`](docs/setup-guide.md)
   - Codex Setup & Lessons Learned: [`docs/codex-setup-guide.md`](docs/codex-setup-guide.md)

## Installation

### 1. Install 4 Core Layers (Default)
Run dry-run installer first (dynamically scans free ports `8787`–`9999`):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-token-stack.ps1
```

Apply to chosen profile:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\install-token-stack.ps1 `
  -ProfileDirectory "$HOME\.claude" `
  -Apply
```

### 2. (Optional) Install Layer 5 Memory Provider
Choose one of the supported memory providers:

```powershell
# Option A: MemoraX Code (Cross-session procedure & context memory)
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\install-memory-layer.ps1 -Provider memorax -Apply

# Option B: Mem0 MCP (Graph & Vector memory)
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\install-memory-layer.ps1 -Provider mem0 -Apply

# Option C: Local Knowledge Memory (100% offline local markdown/sqlite)
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\install-memory-layer.ps1 -Provider local -Apply
```

Or pass `-MemoryProvider <memorax|mem0|local|none>` directly to `install-token-stack.ps1`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\install-token-stack.ps1 `
  -ProfileDirectory "$HOME\.codex" `
  -MemoryProvider memorax `
  -Apply
```

## Health Verification

Check health across all 4 Core Layers + Optional Layer 5:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\skills\token-stack-health\scripts\token-stack-health.ps1
```