# 5 · Free Claude Code — $0 AI Coding (Optional, Advanced)

This lets the **Free Claude Code chat** talk to free AI models instead of paid ones, so you can code and build with AI for **$0**.

> **Good news:** the **voice-building** in `2-VOICE-BUILDING.md` already gives you the headline power (say "build me a game" → it builds, free) **without this step**. This step is only for the full Free Claude Code *chat* panel. If you just want the build magic, you can skip this.

## What you get
The **Free Claude Code → Chat & Workspace** tabs, powered by free models routed through a small local proxy.

## How it works (in plain English)
There's a tiny helper called the **fcc-server** that sits between the Claude tool and the AI. When the Claude tool asks for an answer, the helper quietly sends it to a **free** model instead — either a free cloud model (via OpenRouter) or the one running on your own machine (Ollama, from step 2).

## The steps

**1. Make sure you did Step 2** (Ollama + a model). That's the free brain this uses.

**2. Start the proxy.** The Free Claude Code panel expects the helper on your machine. Run it (it stays running in the background):
```bash
fcc-server
```
*(If `fcc-server` isn't installed, the voice-build from step 2 still works — that path talks to Ollama directly and doesn't need this.)*

**3. Point it at your model.** It reads the same `~/.fcc/.env` file you made in step 2:
```
MODEL="ollama/gemma2"
```
Or point it at a **free OpenRouter model** instead. Two good, current picks (both free, both do the tool-use a coding agent needs):
```
MODEL="open_router/qwen/qwen3-coder:free"        # coder-tuned — best for building
# or
MODEL="open_router/google/gemma-4-31b-it:free"   # strong general model, huge 256K context
```

> ⚠️ **Never use a "stealth" / "alpha" / cloaked model** (names like `owl-alpha`, `sonoma-*`, anything ending `-alpha`). A lab drops those **free for a few weeks** to collect data, then removes them or starts charging — so they suddenly stop working. Always use a **named** `:free` model like the two above.

**Routing the Claude models through OpenRouter?** If you use the advanced `MODEL_OPUS` / `MODEL_SONNET` / `MODEL_HAIKU` lines, point all three at a named free model too:
```
MODEL_OPUS="open_router/qwen/qwen3-coder:free"
MODEL_SONNET="open_router/qwen/qwen3-coder:free"
MODEL_HAIKU="open_router/qwen/qwen3-coder:free"
```

> 💡 **Seeing `Upstream provider OPENROUTER returned HTTP 402 … requires more credits`?** Your free model was retired (this is what happened to `owl-alpha` on 30 June 2026). It's not your fault and it's not broken — just swap the line(s) above to a current `:free` model and restart. No paid credits needed.
>
> 💡 **Seeing `HTTP 429 … Rate limit exceeded: free-models-per-day`?** You've hit OpenRouter's **free daily limit** (50 free-model requests/day for accounts with no credits). It resets each day. Three ways forward: **(1)** add **$5 of credits** to OpenRouter once — it bumps you to **1,000 free requests/day** (you still use the free models, the $5 just raises the limit): <https://openrouter.ai/settings/credits>; **(2)** switch to the **Local** model for *unlimited* free (`MODEL="ollama/gemma2"` — runs on your Mac, no limits); or **(3)** wait for the daily reset. It's a usage limit, not a bug.

## Try it
Open **Free Claude Code → Chat & Workspace** and ask it to build something. Anything it writes shows up in the Workspace tab, ready to preview.

## Honest note
This is the most "techie" piece. If it doesn't click into place, don't worry — **everything else in the Agent OS works fine without it**, and the voice-build from step 2 covers the main "build for free" use.

## Done?
The fun one: run a whole company of agents → **`6-PAPERCLIP.md`**.
