# 32 · SEO Office — a Local SEO Agency OS (Optional, Advanced)

**SEO Office** is a local-first "SEO agency in a box" — a 3D office UI with claude-seo specialist agents and a marketing brain. It's a sub-tab inside the **SEO** section (open the **SEO** tab → **SEO Office**), which embeds the tool running on your own Mac.

It's a separate open-source project (AGPL-3.0), so **you clone + run it yourself** — it's not bundled in the pack.

## What you need
- **Node.js + pnpm** — `npm install -g pnpm` if you don't have pnpm.
- A few minutes to clone + install it once.

## Setup
1. **Clone + install it** (one-time):
   ```bash
   git clone https://github.com/AgriciDaniel/seo-os ~/seo-office && cd ~/seo-office && pnpm install
   ```
2. **Start it:**
   ```bash
   cd ~/seo-office && pnpm dev
   ```
   Leave that running — it serves on `http://localhost:3000`.
3. **Open it** — in Agent OS go to the **SEO** tab → **SEO Office**. When the badge shows **running**, the office loads right inside your dashboard.

> 🟢 Easiest: open any AI agent in the folder and say *"set up SEO Office — clone github.com/AgriciDaniel/seo-os to ~/seo-office, pnpm install, and start it."*

## Good to know
- **Runs on your Mac** — it's a local dev server on `:3000`; nothing is hosted for you.
- **If the tab says "not running"** → `cd ~/seo-office && pnpm dev`, then refresh.
- **Its own project** — SEO Office is maintained separately on GitHub (AGPL-3.0); Agent OS just embeds it. Check its repo for what it can do + any keys it wants.
- Sits alongside **OpenSEO** (`29-OPENSEO.md`, the Semrush/Ahrefs alternative) in the SEO tab — different tools, both optional.
