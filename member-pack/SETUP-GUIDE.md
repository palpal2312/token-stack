# 🔌 Connect Everything — the Setup Guide

This links every model, tool and API so each tab actually works. **You don't have to do it by hand.** The whole point of Agent OS is that an AI sets it up for you — so start there.

---

## ⭐ The easy way — let Claude or Hermes link it all for you

You do **not** need to understand keys or config files. An AI agent does the wiring.

1. Open a coding agent **inside your `agent-os` folder** — **Claude Code**, **Hermes**, Codex, Cursor, or Gemini all work (no Claude subscription needed).
2. Paste this:

   > **"Read SETUP-WITH-AI.md and set up my whole Agent OS. Go tab by tab. For each model, tool and API, tell me what it does and whether I need a paid key — and if I do, give me the exact link to get it, wait for me to paste it, then wire it into the right place and confirm it works. Never enter my card or do a login for me."**

3. The agent walks each feature, asks you for a key **only when one is needed**, puts it in the correct place, and tells you what's working.

That's it. Skip the rest of this page unless you want to do a piece by hand.

> 🔒 **You always enter your own keys and payments.** A safe agent asks *you* to paste a key or do a login — it never types your card or signs in as you.

---

## 🩺 See what's connected

Double-click **`Check My Setup.command`** (Mac) any time. It shows ✅ / ⚪️ for every feature and points you to the guide that connects the missing ones. Nothing you skip breaks anything — that tab just stays quiet.

**Or in the dashboard:** the build version shows under the "Agentic OS" logo (top-left) so you can confirm you're on the latest pack.

---

## 🔑 What each key unlocks (reference)

Add a key only for the tabs you actually use. **Free options first** — most core features cost nothing.

| Tab / feature | Key it needs | Free? | Get it |
|---|---|---|---|
| **Claude** tab | *none* — run `claude login` (uses your Claude subscription) | — | Don't set `ANTHROPIC_API_KEY` — an empty one breaks it |
| **Hermes / Fusion / OmniRoute / Hy3 Coder / free models** | `OPENROUTER_API_KEY` | many `:free` models | <https://openrouter.ai/keys> |
| **Jarvis voice / TTS** | `ELEVENLABS_API_KEY` | free tier | <https://elevenlabs.io> |
| **Thumbnail Studio** | `OPENAI_API_KEY` | paid (cheap) | <https://platform.openai.com/api-keys> |
| **Video Studio (avatars)** | `HEYGEN_API_KEY` | paid | <https://heygen.com> |
| **Music Studio** | `SUNO_API_KEY` | paid | <https://suno.ai> |
| **Live translate (optional)** | `GEMINI_API_KEY` | free tier | <https://aistudio.google.com/apikey> |
| **Leads** | `HUNTER_API_KEY` / `APOLLO_API_KEY` / `FIRECRAWL_API_KEY` | Hunter free tier | hunter.io · apollo.io · firecrawl.dev |
| **Hermes Astros (YouTube)** | *none* (keyless works) — `YT_API_KEY` for more | keyless | Google Cloud console |
| **OpenSEO** | a DataForSEO key (in `~/open-seo/.env`) | paid (cheap) | <https://dataforseo.com> |
| **GLM Code** | an Ollama account (`OLLAMA_API_KEY`) | cloud rates | <https://ollama.com> |
| **GLM 5.2 tab** | `GLM_API_KEY` (z.ai) | paid | <https://z.ai> |
| **Free Claude Code / OmniRoute / Local** | *none* — free models or your own Mac | ✅ free | — |

> 💡 **Where do keys go?** For anything routed through Hermes (OpenRouter and friends) they live in `~/.hermes/.env`; a few tools have their own place. **Let the AI put them there** — that's the whole reason the "easy way" above exists. If you must do it yourself, ask the agent: *"add my `<KEY>` to the right place and restart."*

---

## 💻 Configuring CLI tools (Claude, Codex, Kimi, Grok, Antigravity…)

CLI agents are even simpler — **no keys to paste, just install + log in once:**

1. **Install** the tool you want (each has a one-line installer — see its guide in `install/`).
2. **Log in once** the normal way for that tool. Its tab in the dashboard lights up when it finds the tool + your login.
3. Done. The dashboard **auto-detects** it on your PATH — you never edit a config file.

Key ones:
- **Claude** → `claude login` (browser sign-in with your Claude Pro/Max — **not** an API key). See `install/7-AGENT-CLIS.md`.
- **Codex / Antigravity / Kimi / Grok** → install each (`install/7-AGENT-CLIS.md`, `16-KIMI-CODE.md`, `18-GROK-BUILD.md`), then log in once.
- **Installed somewhere unusual and the tab can't find it?** Tell the agent *"point the dashboard at my `<tool>`"* — it adds the path to `~/.agentic-os/config.json`. Normal installs never need this.

---

## The three places settings live (so you know it's safe)
1. **`~/.agentic-os/config.json`** — your dashboard settings (vault path, your name, model routing, tool paths). Survives every update.
2. **`~/.hermes/`** — your Hermes profiles, keys and sessions.
3. **Your Obsidian vault** — your notes.

Updates only ever replace the app code — these three are **never touched**. So set things up once and they stick.

> **Still stuck on one thing?** Open your agent and say *"this tab isn't working — figure out what it needs and fix it."* That's always the fastest path.
