# ✅ Implementation Checklist — New Install

Tick these off in order. You only need the first four to be up and running — the rest are optional power-ups you add whenever you want.

## Get it running (required)
- [ ] **Node.js 20+ installed** — check with `node -v`. Don't have it? <https://nodejs.org> → big green **LTS** button.
- [ ] **Unzipped the pack** somewhere easy to find (Desktop is fine). *Don't run it from inside the zip.*
- [ ] **Started the dashboard:**
  - **Mac:** double-click `Start Agent OS.command` (first time: right-click → Open → Open).
  - **Windows:** follow `install/25-WINDOWS-INSTALL.md` (the `.command` files are Mac-only).
  - **Linux:** `cd source && npm install && PORT=3737 npm run build && PORT=3737 npm start` (`install/1-CORE-DASHBOARD.md`).
- [ ] **Dashboard opens** at **http://localhost:3737** in **Chrome**. 🎉 That's the core done.

## Make it yours (recommended, ~10 min)
- [ ] **Read `DISCLAIMER.md`** — you run this yourself, at your own risk.
- [ ] **Ran `Check My Setup.command`** (Mac) — shows ✅/⚪️ for each feature and which guide adds the missing ones.
- [ ] **Connected your Obsidian vault** — open any AI agent in the folder and say *"connect my Obsidian vault to the Agent OS"* (`install/11-MEMORY-OBSIDIAN.md`). No vault = empty Memory Galaxy.
- [ ] **Checked your model routing** — read `install/0-HOW-IT-ALL-WORKS.md` (5 min) so you don't route everything through the tiny free model.

## The easy path for everything else
- [ ] **Let an AI set up the rest** — open any coding agent (Claude Code, Codex, Cursor, Gemini, or Hermes — no Claude subscription needed) in the folder and paste:
  > *"Read SETUP-WITH-AI.md and set up the whole Agent OS for me, step by step. Ask me whenever you need a key or a decision."*

## Add features when you want them
- [ ] Pick from the numbered guides in `install/` — each tab has one. Nothing breaks if you skip a tab; it just stays quiet.
- [ ] **New here?** Follow `30-DAY-ROADMAP.md` — one thing a day from "just installed" to running an AI-first operation.

> Stuck at any step? `install/8-TROUBLESHOOTING.md`, or ask any AI agent in the folder to look at it.
