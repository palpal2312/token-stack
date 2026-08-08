# 27 · GPT 5.6 Code — One Tab, Four Coding Brains (Optional)

> 📛 In the sidebar this tab is called **"GPT 5.6 Code"** (it defaults to GPT 5.6, no setup). It has a **model picker** — GPT 5.6, **GLM-5.2**, **Kimi K3**, and **Qwen 3.8** — so it's the same build-me-an-app agent with four brains to choose from. This guide covers all four; GLM-5.2 has the most setup, so it's the bulk below.

The tab runs a *real* coding agent that builds whole apps for you and previews them in the tab. Pick the brain in the dropdown:

- **GPT 5.6** *(default — nothing to install beyond the `codex` login, see `7-AGENT-CLIS.md`)* — OpenAI's Codex agent on your ChatGPT login. No API key.
- **GLM-5.2** — the real Claude Code agent pointed at GLM-5.2 via Ollama Cloud (cheap per token). Setup below.
- **Kimi K3** — Moonshot's coding agent → install per `16-KIMI-CODE.md` (`kimi login`).
- **Qwen 3.8** — Alibaba's 2.4T flagship via the **Qoder** agent (GoldieBench #5, ties Fable 5). Setup in the last section.

Great for building **web apps and tools**. For heavy 3D/game work, use Free Claude Code or real Claude.

---

## Using GLM-5.2

## How it works (you don't need to understand this)
Agent OS launches the `claude` CLI but tells it to talk to your **local Ollama** (`http://localhost:11434`), which proxies the `glm-5.2:cloud` model up to Ollama Cloud. So it's the Claude Code experience on a cheaper brain.

## What you need
1. **Claude Code installed** — the `claude` command (you likely already have it from `5-FREE-CLAUDE-CODE.md` / `7-AGENT-CLIS.md`).
2. **Ollama installed + running** — the same Ollama you use for voice building (`2-VOICE-BUILDING.md`). Its daemon must be running (it serves `localhost:11434`).
3. **An Ollama Cloud account** — because `glm-5.2:cloud` runs in the cloud. Make a free account at **<https://ollama.com>**, then give Agent OS your key:
   - Get your key from your Ollama account (ollama.com → your settings → API keys).
   - Set it as **`OLLAMA_API_KEY`** (in your environment, or in `~/.agentic-os/config.json`-adjacent `.env.local`).

> 🟢 Easiest setup: open any AI agent in the folder and say *"set up GLM Code — check Claude Code and Ollama are installed, and help me add my Ollama key."* It checks each piece and tells you what's missing.

## How to use it
1. Open the **GLM Code** tab.
2. Type what you want built (e.g. *"build me a tip calculator web app with a clean dark UI"*).
3. It runs the Claude Code agent on GLM-5.2 and writes the files; you watch progress and preview the result right in the tab.
4. Every build is also logged to your Obsidian vault (`Agentic OS/GLM Code Log.md`) if your vault is connected.

## Add Qwen 3.8 (Qoder) — the frontier option
Qwen 3.8 (`Qwen3.8-Max-Preview`) is Alibaba's 2.4T flagship — on our GoldieBench leaderboard it's **#5, tied with Fable 5**. Right now it runs **only through Qoder** (Alibaba's coding agent), so there's no API key — you log in to Qoder (free 2-week Pro trial).

1. **Install the Qoder CLI:**
   ```bash
   npm install -g @qoder-ai/qodercli
   ```
2. **Log in** (opens a browser; free trial, your account):
   ```bash
   qoder login
   ```
3. **Create the Qwen 3.8 wrapper.** Agent OS runs a command called `qoder-qwen` that pins Qoder to the Qwen 3.8 model — make it once:
   ```bash
   mkdir -p ~/.local/bin
   printf '#!/bin/bash\nexec qodercli -m "Qwen3.8-Max-Preview" "$@"\n' > ~/.local/bin/qoder-qwen
   chmod +x ~/.local/bin/qoder-qwen
   ```
   Make sure `~/.local/bin` is on your PATH (most Macs already have it).
4. Open the tab, pick **Qwen 3.8** in the dropdown, and build.

> 🟢 Easiest: tell any AI agent in the folder *"install the Qoder CLI (@qoder-ai/qodercli), run qoder login, and create a ~/.local/bin/qoder-qwen wrapper that runs qodercli with -m Qwen3.8-Max-Preview."*

**Heads-up:** Qwen 3.8 builds are **strong but slow** — a heavy 3D build can take 15–25 minutes. Great when you want quality; for quick iterations use GPT 5.6 or GLM.

## Good to know
- **Why use it?** It's the full agentic coding loop (reads, plans, writes, fixes) for a fraction of the cost — perfect for everyday web builds where you don't need a frontier model.
- **Costs are yours** — Ollama Cloud bills your account for what you generate. Nothing is charged by Agent OS.
- **It needs Ollama running** — if the tab says it can't connect, start Ollama and refresh.
- **Pick the right brain for the job:** GLM Code for web apps/tools; Free Claude Code or real Claude for complex 3D games and the hardest reasoning.
