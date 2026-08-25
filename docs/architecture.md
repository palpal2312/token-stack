# The 7-Layer Master Token & Context Engine Architecture

## 1. System Overview

Token Stack is an end-to-end, multi-layer token reduction and contextual intelligence engine for AI coding agents (OpenAI Codex CLI, Claude Code, Cursor, Gemini CLI).

It optimizes the entire lifecycle of an AI coding task across 4 fundamental domains:
1. **Pre-Coding (Code Discovery)**: AST-level code topology eliminates blind searching.
2. **In-Flight (Active Session)**: Multi-stage prompt, code, CLI, and network payload compression.
3. **Post-Task (Knowledge Harvesting)**: Automatic extraction of verified workflows and engineering patterns.
4. **Cross-Session (Hierarchical Context Platform)**: Multi-tier 3-level context delivery (L0/L1/L2) with zero memory bloat.

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

---

## 2. Layer-by-Layer Breakdown

### Layer 0: Code Topology & AST Knowledge Graph
- **Role**: Locates functions, call chains, and module dependencies with zero API token cost.
- **Engines**:
  - `Graphify`: Multi-modal AST knowledge graph covering code, docs, and architecture (`graph.json`).
  - `GitNexus`: Deep call chains & blast radius analysis via WASM / MCP.
  - `CodeGraph`: Real-time file-watcher with SQLite WAL daemon.
- **Command**: `.\scripts\install-code-graph.ps1 -Engine <graphify|gitnexus|codegraph|none>`

### Layer 1: Code Reduction (Ponytail)
- **Role**: Prompts the AI model to write concise, functional, idiomatic code without unnecessary abstraction layers.

### Layer 2: Word Reduction (Caveman)
- **Role**: Strips conversational filler, preamble, and unnecessary pleasantries while preserving precise technical symbols.

### Layer 3: CLI Output Filter (RTK - Rust Token Killer)
- **Role**: Intercepts verbose terminal outputs (`git diff`, `go test`, `npm run build`, `cargo check`) and compresses 500-line outputs into 10-line summaries.

### Layer 4: Context Compression Proxy (Headroom)
- **Role**: Runs as a local HTTP proxy (`127.0.0.1:<free-port>` in range `8787`–`9999`) performing lossless token deduplication and maintaining prompt prefix cache.

### Layer 5: Knowledge Harvester (MemoraX Code)
- **Role**: Acts as the in-session knowledge extractor, listening to turns and distilling verified bugfixes and design decisions into structured memory cases.

### Layer 6: Context Database Platform (OpenViking / Obsidian)
- **Role**: Acts as the persistent storage and hierarchical serving foundation.
- **Platforms**:
  - `OpenViking` (`viking://`): AI-native 3-tier progressive loading (**L0 ~100 tok** $\rightarrow$ **L1 ~2k tok** $\rightarrow$ **L2 On-demand**).
  - `Obsidian Vault`: Human-in-the-loop Markdown vault with graph view.
- **Command**: `.\scripts\install-context-platform.ps1 -Platform <openviking|obsidian|local|none>`

---

## 3. End-to-End Task Lifecycle

1. **Task Dispatch**: User requests a complex refactor or bugfix.
2. **Context Seeding (Layer 6)**: OpenViking injects **L0 (~100 tokens)** overview of the relevant spec.
3. **Experience Recall (Layer 5)**: MemoraX recalls project rules and past verified fixes.
4. **Code Navigation (Layer 0)**: Graphify points directly to the target symbol without blind file scanning.
5. **Implementation (Layer 1)**: Ponytail ensures concise code delivery.
6. **Explanation (Layer 2)**: Caveman delivers crisp response text.
7. **Verification (Layer 3)**: RTK filters test logs into clean summaries.
8. **Transmission (Layer 4)**: Headroom compresses the HTTP payload and caches context prefixes.
9. **Knowledge Harvest (Layer 5 $\rightarrow$ Layer 6)**: Completed task learnings are harvested and stored into `viking://memory/cases/`.