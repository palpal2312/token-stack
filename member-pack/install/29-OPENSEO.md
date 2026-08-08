# 29 · OpenSEO — Your Own Semrush/Ahrefs (Optional)

**OpenSEO** is a free, self-hosted alternative to Semrush/Ahrefs — keyword research, rank tracking, backlinks, and site audits — running **locally on your Mac**. It's a sub-tab inside the **SEO** section (open the **SEO** tab, then click **OpenSEO**).

It's powered by your own **DataForSEO** key, so you pay DataForSEO's low pay-as-you-go rates instead of a Semrush subscription.

## What you need
- **Docker Desktop** — the free app that runs OpenSEO. Get it: <https://www.docker.com/products/docker-desktop>
- **A DataForSEO account** — for the actual SEO data (cheap, pay-as-you-go): <https://dataforseo.com>

## Setup
1. **Install + open Docker Desktop** and let it start.
2. **Get OpenSEO + start it** (one-time):
   ```bash
   # clone into ~/open-seo (or wherever), then:
   cd ~/open-seo
   docker compose up -d
   ```
3. **Add your DataForSEO key** — put it in `~/open-seo/.env`, then restart the container (`docker compose up -d` again).
4. **Open it** — in Agent OS go to the **SEO** tab → **OpenSEO**. When the badge shows **running**, you're set. (Behind the scenes it runs on `http://localhost:3001` and Agent OS embeds it.)

> 🟢 Easiest: open any AI agent in the folder and say *"set up OpenSEO — check Docker is running, start the OpenSEO container, and help me add my DataForSEO key."*

## Use it
- **SEO tab → OpenSEO.** Do keyword research, track rankings, check backlinks and run site audits — all from inside your dashboard.
- If the tab says **not running**, start Docker + `docker compose up -d` in `~/open-seo`, then refresh.

## Good to know
- **Runs on your Mac** — your data stays local; only DataForSEO calls go out (billed to your DataForSEO account).
- **No monthly SEO subscription** — you own the tool; you only pay per DataForSEO lookup.
- Needs Docker running. If OpenSEO is down, the SEO tab's other tools (Research, Generate, Deploy) still work fine.
