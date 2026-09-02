---
name: token-stack:setup
description: Automated setup, configuration, and provisioning engine across all 14 layers of the Token & Context Engine. Use for initial setup, component repair, and global CLI registration.
user-invocable: true
---

# Token Stack Setup Engine (14-Layer Automated Setup)

The setup engine inspects, provisions, configures, and verifies all required components across the **14-Layer Master Token & Context Engine**:

## 📋 Configured Layers & Components

1. **Layer -1: Semantic Cache**: Provisions SQLite database at `~/.token-stack/cache.db` with indexed schema.
2. **Layer 0: Model Router**: Provisions `~/.token-stack/router-config.json` with multi-tier model cascading (`cheap: kimi-k3`, `standard: claude-3-5-sonnet`, `flagship: claude-3-7-sonnet`).
3. **Layer 0.5: Dynamic Skill Router**: Pre-indexes all 240+ skills into `~/.token-stack/skills-cache.json` and enables Dual-Scope (Internal vs Harness) routing.
4. **Layer 1: Code Topology Engine**: Validates AST graph extractor & Graphify integration.
5. **Layer 1.5: Data Lens & Columnar Engine**: Probes ClickHouse HTTP port 8123 and provisions DuckDB / Zero-Row Stream Shield fallback.
6. **Layer 2 & 3: Ponytail & Caveman**: Safely enables `caveman@caveman` and `ponytail@ponytail` plugins in profile `settings.json`.
7. **Layer 4: RTK CLI Output Filter**: Validates RTK binary or provisions terminal log filter shim.
8. **Layer 5-7: In-Flight Governors**: Validates Turn Folding (5-turn Epoch Freezing), CoT Governor, and Loop Breaker circuit breaker.
9. **Layer 8: Headroom Context Proxy**: Checks daemon executables, upstream mappings (9284), and profile ports (8787+).
10. **Layer 9 & 10: MemoraX & OpenViking**: Creates episodic memory workspace `~/.token-stack/memory/` and context DB directories.
11. **Global CLI**: Registers global `token-stack` command and CMD wrapper in PATH.

## 🚀 Usage

### Step 1: Preview Actions (Dry-Run)
```powershell
token-stack setup
```

### Step 2: Apply Configuration
```powershell
token-stack setup -Apply
```

### Step 3: Verify Probes
```powershell
token-stack doctor
```

Pass `-ProfileDirectory <path>` to target a custom Claude/Codex profile directory.
