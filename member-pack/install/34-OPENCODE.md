# 34 · opencode — Free Terminal Coding Agent (Optional)

The **opencode** tab runs [opencode](https://opencode.ai) — a popular open-source coding agent (160k★) — right inside the Agent OS. You type a prompt, it builds real files with a live tool loop on the right, and you download the result.

It ships a **built-in free tier** (the `opencode` "Zen" provider), so it builds real apps for **$0 with no API key** out of the box. Anyone who's logged in with their own provider can pick that model too.

## Setup (1 step)
1. **Install opencode** (free, open-source):
   ```bash
   curl -fsSL https://opencode.ai/install | bash
   ```
   That's it. Open the **opencode** tab — when it shows **"Ready"**, type a prompt and go.

> 🟢 Easiest: open any AI agent in the folder and say *"install opencode for me."*

## Bring your own model (optional)
opencode is provider-agnostic (75+ providers via models.dev). To use your own:
```bash
opencode auth login
```
Then pick your model in the tab's model dropdown.

## Good to know
- **Free out of the box** — the built-in Zen models (Nemotron 3 Ultra is the default) cost $0, no key.
- **Local + private** — it runs the `opencode` binary on your Mac; nothing extra leaves your machine.
- **Optional overrides** (advanced, you rarely need these):
  - `OPENCODE_MODEL` — force a different default model.
  - `OPENCODE_BIN` — path to the `opencode` binary if it's not in the usual place.
- Pick the right tool: opencode / OmniRoute / Free Claude Code / GLM Code for free builds; real Claude for the hardest work.
