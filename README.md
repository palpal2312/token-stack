# token-stack

The Complete **7-Layer Master Token & Context Engine** for AI coding CLIs (OpenAI Codex CLI, Claude Code, Cursor, Kimi, Antigravity):

- 📍 **Layer 0: Code Topology** -> **Graphify / GitNexus / CodeGraph** (AST code map, 0 token search)
- ✍️ **Layer 1: Code Reduction** -> **Ponytail** (less boilerplate, stdlib, YAGNI)
- 💬 **Layer 2: Word Reduction** -> **Caveman** (fewer conversational filler words)
- ⚡ **Layer 3: CLI Output Filter** -> **RTK** (filters verbose command outputs)
- 🌐 **Layer 4: Context Proxy** -> **Headroom** (lossless context compression & prompt cache)
- 🧠 **Layer 5: Knowledge Harvester** -> **MemoraX Code** (auto-extracts lessons & procedures from completed tasks)
- 🗄️ **Layer 6: Context Database Platform** -> **OpenViking / Obsidian Vault** (hierarchical L0/L1/L2 storage, saves 91% tokens)

## Architecture

```text
+-------------------------------------------------------------------------------------------------------------+
|                                         THE 7-LAYER MASTER STACK                                            |
+-------------------------------------------------------------------------------------------------------------+
|  📍 [Layer 0: Code Topology]       -> GRAPHIFY / GITNEXUS / CODEGRAPH (AST navigation, 0 token search)           |
|  ✍️  [Layer 1: Code Reduction]      -> PONYTAIL (KISS, YAGNI, standard library, no boilerplate)                   |
|  💬 [Layer 2: Word Reduction]      -> CAVEMAN (Concise technical responses, no conversational fluff)             |
|  ⚡ [Layer 3: CLI Output Filter]    -> RTK - Rust Token Killer (60-90% log reduction on git/build/test)           |
|  🌐 [Layer 4: Context Proxy]       -> HEADROOM PROXY (Lossless HTTP context compression & prompt caching)       |
+ - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - +
|  🧠 [Layer 5: Knowledge Harvester] -> MEMORAX CODE (Auto-extracts lessons & procedures from completed tasks)     |
|                                             │                                                               |
|                                             ▼ (Data pipeline transfer)                                      |
|  🗄️  [Layer 6: Context Database]    -> OPENVIKING / OBSIDIAN VAULT (Hierarchical 3-tier L0/L1/L2 storage)          |
|                                         ├── viking://knowledge (Hierarchical 3-tier RAG, saves 91% tokens)  |
|                                         ├── viking://skills    (Dynamic on-demand skills, no budget bloat)   |
|                                         └── viking://memory    (Persistent memory inherited from MemoraX)    |
+-------------------------------------------------------------------------------------------------------------+
```

## Quick Start & Documentation

1. Architecture Deep-Dive: [`docs/architecture.md`](docs/architecture.md)
2. Setup Guide (Multi-profile): [`docs/setup-guide.md`](docs/setup-guide.md)
3. OpenAI Codex CLI Setup & Lessons Learned: [`docs/codex-setup-guide.md`](docs/codex-setup-guide.md)

## Installation

Run the master installer to configure all 7 layers:

```powershell
# Dry-run inspection
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-token-stack.ps1

# Apply to target profile with custom engines
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\install-token-stack.ps1 `
  -ProfileDirectory "$HOME\.claude" `
  -CodeTopology graphify `
  -Harvester memorax `
  -ContextDatabase openviking `
  -Apply
```

## Modular Layer Installers

- **Layer 0 (Code Topology)**: `.\scripts\install-code-graph.ps1 -Engine <graphify|gitnexus|codegraph|none> -Apply`
- **Layer 5 (Knowledge Harvester)**: `.\scripts\install-memory-layer.ps1 -Provider <memorax|none> -Apply`
- **Layer 6 (Context Database Platform)**: `.\scripts\install-context-platform.ps1 -Platform <openviking|obsidian|local|none> -Apply`

## Health Verification

Check health and connectivity across all 7 layers:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\skills\token-stack-health\scripts\token-stack-health.ps1
```